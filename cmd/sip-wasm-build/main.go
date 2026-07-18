// sip-wasm-build compiles a Go package to WebAssembly, injecting
// js/wasm stubs into BubbleTea v2 at build time so a sip-rendered
// BubbleTea app can run entirely in the browser.
//
// BubbleTea v2 lacks js/wasm build tags for signal handling and TTY
// initialization (charmbracelet/bubbletea#1410). This tool works
// around that by copying BubbleTea to a temp directory, adding stub
// files, and building through a temporary go.mod replace directive.
//
// Usage:
//
//	go run github.com/Gaurav-Gosain/sip/cmd/sip-wasm-build \
//	    -o web/app.wasm ./cmd/myapp/
//
// All flags and arguments are forwarded to `go build` unchanged.
// GOOS=js and GOARCH=wasm are set automatically.
package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
)

//go:embed all:_stubs
var stubsFS embed.FS

const bubbleteaModule = "charm.land/bubbletea/v2"

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "Usage: sip-wasm-build [go build flags] <packages>")
		fmt.Fprintln(os.Stderr, "  e.g. sip-wasm-build -o web/app.wasm ./cmd/myapp/")
		os.Exit(2)
	}
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "sip-wasm-build: %v\n", err)
		os.Exit(1)
	}
}

func run(buildArgs []string) error {
	download := exec.Command("go", "mod", "download")
	download.Stderr = os.Stderr
	if err := download.Run(); err != nil {
		return fmt.Errorf("go mod download: %w", err)
	}

	btDir, err := findModuleDir(bubbleteaModule)
	if err != nil {
		return fmt.Errorf("locate %s: %w", bubbleteaModule, err)
	}

	origModPath, err := goEnv("GOMOD")
	if err != nil {
		return fmt.Errorf("locate go.mod: %w", err)
	}
	if origModPath == "" || origModPath == os.DevNull {
		return errors.New("no go.mod found — run this from a Go module")
	}

	tmpDir, err := os.MkdirTemp("", "sip-wasm-build-*")
	if err != nil {
		return fmt.Errorf("create temp dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()

	btCopy := filepath.Join(tmpDir, "bubbletea")
	if err := copyTree(btDir, btCopy); err != nil {
		return fmt.Errorf("copy bubbletea: %w", err)
	}

	if err := fs.WalkDir(stubsFS, "_stubs", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		data, err := stubsFS.ReadFile(path)
		if err != nil {
			return err
		}
		name := filepath.Base(path)
		return os.WriteFile(filepath.Join(btCopy, name), data, 0o644)
	}); err != nil {
		return fmt.Errorf("write stubs: %w", err)
	}

	tmpMod := filepath.Join(tmpDir, "go.mod")
	if err := copyFile(origModPath, tmpMod); err != nil {
		return fmt.Errorf("copy go.mod: %w", err)
	}
	origSum := filepath.Join(filepath.Dir(origModPath), "go.sum")
	if _, err := os.Stat(origSum); err == nil {
		if err := copyFile(origSum, filepath.Join(tmpDir, "go.sum")); err != nil {
			return fmt.Errorf("copy go.sum: %w", err)
		}
	}

	editCmd := exec.Command("go", "mod", "edit",
		"-modfile="+tmpMod,
		"-replace="+bubbleteaModule+"="+btCopy)
	editCmd.Stderr = os.Stderr
	if err := editCmd.Run(); err != nil {
		return fmt.Errorf("add replace directive: %w", err)
	}

	args := append([]string{"build", "-modfile=" + tmpMod}, buildArgs...)
	cmd := exec.Command("go", args...)
	cmd.Env = append(os.Environ(), "GOOS=js", "GOARCH=wasm")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func findModuleDir(path string) (string, error) {
	out, err := exec.Command("go", "list", "-m", "-json", path).Output()
	if err != nil {
		return "", err
	}
	var info struct{ Dir string }
	if err := json.Unmarshal(out, &info); err != nil {
		return "", err
	}
	if info.Dir == "" {
		return "", fmt.Errorf("module %s not in module cache", path)
	}
	return info.Dir, nil
}

func goEnv(name string) (string, error) {
	out, err := exec.Command("go", "env", name).Output()
	if err != nil {
		return "", err
	}
	s := string(out)
	if n := len(s); n > 0 && s[n-1] == '\n' {
		s = s[:n-1]
	}
	return s, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relPath, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, relPath)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if err := copyFile(path, target); err != nil {
			return err
		}
		return os.Chmod(target, 0o644)
	})
}
