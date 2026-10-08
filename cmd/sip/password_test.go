//go:build !windows

package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Gaurav-Gosain/sip"
	"github.com/coder/websocket"
)

// These tests run the real sip binary, because the leak is between the CLI
// and the program it spawns.

func buildSip(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "sip")
	out, err := exec.Command("go", "build", "-o", bin, ".").CombinedOutput()
	if err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	return bin
}

// randomSecret makes a throwaway password for one test run.
func randomSecret(t *testing.T) string {
	t.Helper()
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b)
}

func freePort(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	_, port, _ := net.SplitHostPort(l.Addr().String())
	return port
}

// syncBuffer is the log of a running sip. exec copies the output in its own
// goroutine, so a test that reads the log while sip runs needs the lock.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// sipProcess is a running sip. exited closes when the process ends. Only the
// goroutine started by startSip calls Wait, so the test and the cleanup never
// both do.
type sipProcess struct {
	cmd     *exec.Cmd
	logs    *syncBuffer
	exited  chan struct{}
	waitErr error
}

// startSip runs the binary and stops it by its own PID when the test ends.
func startSip(t *testing.T, bin string, env []string, args ...string) *sipProcess {
	t.Helper()
	cmd := exec.Command(bin, args...)
	cmd.Env = append(os.Environ(), env...)
	p := &sipProcess{cmd: cmd, logs: &syncBuffer{}, exited: make(chan struct{})}
	cmd.Stdout = p.logs
	cmd.Stderr = p.logs
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	go func() {
		p.waitErr = cmd.Wait()
		close(p.exited)
	}()
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		<-p.exited
	})
	return p
}

// dialSip connects to sip's WebSocket with basic auth. It retries until sip
// listens, and fails the test if sip exits first.
func dialSip(t *testing.T, ctx context.Context, p *sipProcess, port, user, pass string) *websocket.Conn {
	t.Helper()
	auth := "Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+pass))
	for {
		conn, _, err := websocket.Dial(ctx, "ws://127.0.0.1:"+port+"/ws", &websocket.DialOptions{
			HTTPHeader: http.Header{"Authorization": {auth}},
		})
		if err == nil {
			t.Cleanup(func() { _ = conn.CloseNow() })
			return conn
		}
		select {
		case <-p.exited:
			t.Fatalf("sip exited (%v) before it served\nsip log:\n%s", p.waitErr, p.logs)
		case <-ctx.Done():
			t.Fatalf("dial: %v\nsip log:\n%s", err, p.logs)
		case <-time.After(100 * time.Millisecond):
		}
	}
}

// TestPasswordDoesNotReachTheProgram serves a command that prints
// $SIP_PASSWORD and reads what the browser would get.
func TestPasswordDoesNotReachTheProgram(t *testing.T) {
	bin := buildSip(t)
	port := freePort(t)
	secret := randomSecret(t)
	p := startSip(t, bin, []string{"SIP_PASSWORD=" + secret},
		"-p", port, "--basic-user", "admin", "--allow-insecure-no-tls",
		"--", "sh", "-c", `printf 'LEAK=[%s]\n' "$SIP_PASSWORD"; sleep 5`)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn := dialSip(t, ctx, p, port, "admin", secret)

	resize, _ := json.Marshal(sip.ResizeMessage{Cols: 80, Rows: 24})
	if err := conn.Write(ctx, websocket.MessageBinary, append([]byte{sip.MsgResize}, resize...)); err != nil {
		t.Fatalf("resize: %v", err)
	}
	leak := regexp.MustCompile(`LEAK=\[([^\]]*)\]`)
	var out strings.Builder
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatalf("read: %v (output so far %q)", err, out.String())
		}
		if len(data) > 0 && data[0] == sip.MsgOutput {
			out.Write(data[1:])
		}
		if m := leak.FindStringSubmatch(out.String()); m != nil {
			if m[1] != "" {
				t.Fatalf("the program read SIP_PASSWORD=%q from its environment", m[1])
			}
			return
		}
	}
}

// TestPasswordFileMode starts sip with a password file in several modes. A
// mode that gives the group or other users any access must stop sip before it
// serves, with the fix in the message. Mode 600 must serve.
func TestPasswordFileMode(t *testing.T) {
	bin := buildSip(t)
	for _, tc := range []struct {
		mode    os.FileMode
		refused bool
	}{
		{0o644, true},
		{0o640, true}, // the group can hold other users
		{0o620, true}, // write access is access too
		{0o600, false},
		{0o400, false},
	} {
		t.Run(tc.mode.String(), func(t *testing.T) {
			secret := randomSecret(t)
			file := filepath.Join(t.TempDir(), "pass")
			if err := os.WriteFile(file, []byte(secret+"\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(file, tc.mode); err != nil {
				t.Fatal(err)
			}
			port := freePort(t)
			p := startSip(t, bin, nil,
				"-p", port, "--basic-user", "admin", "--basic-pass-file", file,
				"--allow-insecure-no-tls", "--", "sleep", "30")

			if !tc.refused {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				dialSip(t, ctx, p, port, "admin", secret)
				return
			}
			select {
			case <-p.exited:
				if p.waitErr == nil {
					t.Fatalf("sip exited 0 with a password file in mode %v\n%s", tc.mode, p.logs)
				}
				// fang wraps the message, so compare with the whitespace folded.
				if !strings.Contains(strings.Join(strings.Fields(p.logs.String()), " "), "Run 'chmod 600") {
					t.Fatalf("the refusal does not say what to do:\n%s", p.logs)
				}
			case <-time.After(20 * time.Second):
				t.Fatalf("sip served with a password file in mode %v\n%s", tc.mode, p.logs)
			}
		})
	}
}
