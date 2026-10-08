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

// startSip runs the binary and stops it by its own PID when the test ends.
func startSip(t *testing.T, bin string, env []string, args ...string) (*exec.Cmd, *bytes.Buffer) {
	t.Helper()
	cmd := exec.Command(bin, args...)
	cmd.Env = append(os.Environ(), env...)
	var logs bytes.Buffer
	cmd.Stdout = &logs
	cmd.Stderr = &logs
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})
	return cmd, &logs
}

// TestPasswordDoesNotReachTheProgram serves a command that prints
// $SIP_PASSWORD and reads what the browser would get.
func TestPasswordDoesNotReachTheProgram(t *testing.T) {
	bin := buildSip(t)
	port := freePort(t)
	secret := randomSecret(t)
	_, logs := startSip(t, bin, []string{"SIP_PASSWORD=" + secret},
		"-p", port, "--basic-user", "admin", "--allow-insecure-no-tls",
		"--", "sh", "-c", `printf 'LEAK=[%s]\n' "$SIP_PASSWORD"; sleep 5`)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	auth := "Basic " + base64.StdEncoding.EncodeToString([]byte("admin:"+secret))
	var conn *websocket.Conn
	for {
		var err error
		conn, _, err = websocket.Dial(ctx, "ws://127.0.0.1:"+port+"/ws", &websocket.DialOptions{
			HTTPHeader: http.Header{"Authorization": {auth}},
		})
		if err == nil {
			break
		}
		if ctx.Err() != nil {
			t.Fatalf("dial: %v\nsip log:\n%s", err, logs)
		}
		time.Sleep(100 * time.Millisecond)
	}
	defer func() { _ = conn.CloseNow() }()

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

// TestPasswordFileOthersCanReadIsRefused starts sip with a password file in
// mode 0644. It must exit with the fix in the message, before it serves.
func TestPasswordFileOthersCanReadIsRefused(t *testing.T) {
	bin := buildSip(t)
	file := filepath.Join(t.TempDir(), "pass")
	if err := os.WriteFile(file, []byte(randomSecret(t)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(file, 0o644); err != nil {
		t.Fatal(err)
	}
	cmd, logs := startSip(t, bin, nil,
		"-p", freePort(t), "--basic-user", "admin", "--basic-pass-file", file,
		"--allow-insecure-no-tls", "--", "true")
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatalf("sip exited 0 with a password file in mode 0644\n%s", logs)
		}
		// fang wraps the message, so compare with the whitespace folded.
		if !strings.Contains(strings.Join(strings.Fields(logs.String()), " "), "Run 'chmod 600") {
			t.Fatalf("the refusal does not say what to do:\n%s", logs)
		}
	case <-time.After(20 * time.Second):
		t.Fatalf("sip served with a password file in mode 0644\n%s", logs)
	}
}
