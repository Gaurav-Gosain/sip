# Sip - Serve Bubble Tea Apps Through the Browser

> Drinking tea through the browser 🍵

**Status:** v0.1.0 - Initial Release

Sip is a Go library that allows you to serve any [Bubble Tea](https://github.com/charmbracelet/bubbletea) application through a web browser with full terminal emulation, mouse support, and hardware-accelerated rendering.

## Demonstration 
*Take a sip!*

[demonstration-tuios-sip.webm](https://github.com/user-attachments/assets/fc43cd32-a624-43f3-82ff-7721c5bb03da)

## Features

- **WebGL Rendering** - GPU-accelerated terminal rendering via xterm.js for smooth 60fps
- **Dual Protocol Support** - WebTransport (HTTP/3 over QUIC) with automatic WebSocket fallback  
- **Embedded Assets** - All static files (HTML, CSS, JS, fonts) bundled in the binary via go:embed
- **Bundled Nerd Fonts** - JetBrains Mono Nerd Font included, no client-side installation needed
- **Session Management** - Handle multiple concurrent users with isolated sessions
- **Mouse Support** - Full mouse interaction support
- **Auto-Reconnect** - Automatic reconnection with exponential backoff
- **Pure Go** - No CGO dependencies, statically compiled binaries
- **Zero Configuration** - Works out of the box with sensible defaults
- **Wish-like API** - Familiar handler pattern for Charm ecosystem users

## Installation

```bash
go get github.com/Gaurav-Gosain/sip
```

## CLI Usage

Sip also provides a CLI to wrap any command and expose it through the browser:

```bash
# Install the CLI
go install github.com/Gaurav-Gosain/sip/cmd/sip@latest

# Run htop in browser
sip -- htop

# Run on a specific port
sip -p 8080 -- claude -c

# Expose on all interfaces
sip --host 0.0.0.0 -- bash
```

Then open http://localhost:7681 in your browser.

## Library Usage (Quick Start)

```go
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"

	tea "charm.land/bubbletea/v2"
	"github.com/Gaurav-Gosain/sip"
)

type model struct {
	count int
}

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		switch msg.String() {
		case "q":
			return m, tea.Quit
		case "up":
			m.count++
		case "down":
			m.count--
		}
	}
	return m, nil
}

func (m model) View() tea.View {
	return tea.NewView(fmt.Sprintf("Count: %d\n\nPress up/down to change, q to quit", m.count))
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	server := sip.NewServer(sip.DefaultConfig())

	err := server.Serve(ctx, func(sess sip.Session) (tea.Model, []tea.ProgramOption) {
		return model{}, nil
	})
	if err != nil {
		fmt.Println(err)
	}
}
```

Then open http://localhost:7681 in your browser.

## API

### Handler Pattern (Recommended)

Similar to [Wish](https://github.com/charmbracelet/wish)'s Bubble Tea middleware:

```go
// Handler creates a model and options for each session
type Handler func(sess Session) (tea.Model, []tea.ProgramOption)

// Use with Serve()
server.Serve(ctx, func(sess sip.Session) (tea.Model, []tea.ProgramOption) {
    pty := sess.Pty()
    return myModel{width: pty.Width, height: pty.Height}, nil
})
```

### ProgramHandler Pattern (Advanced)

For more control over tea.Program creation:

```go
// ProgramHandler creates a tea.Program directly
type ProgramHandler func(sess Session) *tea.Program

// Use with ServeWithProgram()
server.ServeWithProgram(ctx, func(sess sip.Session) *tea.Program {
    return tea.NewProgram(myModel{}, sip.MakeOptions(sess)...)
})
```

### Session Interface

```go
type Session interface {
    Pty() Pty                        // Get terminal dimensions
    Context() context.Context        // Session context (cancelled on disconnect)
    Read(p []byte) (n int, err error)   // Read from terminal
    Write(p []byte) (n int, err error)  // Write to terminal
    WindowChanges() <-chan WindowSize   // Receive window resize events
}

type Pty struct {
    Width  int
    Height int
}
```

### Configuration

```go
config := sip.Config{
    Host:           "localhost",   // Bind address
    Port:           "7681",        // HTTP port (WebTransport uses Port+1)
    ReadOnly:       false,         // Disable input
    MaxConnections: 0,             // Connection limit (0 = unlimited)
    IdleTimeout:    0,             // Idle timeout (0 = no timeout)
    AllowOrigins:   nil,           // CORS origins (nil = all)
    Debug:          false,         // Enable debug logging
}
```

## How It Works

1. Browser connects via WebSocket (or WebTransport if available)
2. Sip creates a PTY (pseudo-terminal) for proper terminal semantics
3. Your Bubble Tea model is created via the handler
4. Terminal I/O is bridged between the PTY and browser via xterm.js
5. Mouse events, keyboard input, and window resizes are forwarded to your model

## Clipboard

Sip supports copying from the remote terminal to your local system clipboard.
There are two independent paths, and which one you need depends on the program
you run.

Native browser selection (works everywhere, no config):

- Left-click and drag to select text, then release. The selection is copied
  automatically.
- Double-click copies a word, triple-click copies a line.
- When a program holds the mouse (tmux, vim, htop with mouse mode on), hold
  Shift while dragging to select. Shift bypasses mouse reporting so the browser
  can select the screen text. Press Ctrl+Shift+C to copy, or enable "Copy on
  select" in the settings panel to copy on release.
- Right-click opens the browser menu with the usual copy and paste entries.

OSC 52 (programs that write to the clipboard themselves):

- Programs such as vim and tmux can push text to the clipboard with an OSC 52
  escape. Sip forwards these to the browser, which writes them to your system
  clipboard. This is enabled in the bundled web client.
- tmux does not emit OSC 52 under its default `set-clipboard external`. If you
  run tmux inside Sip and want yanks to reach your clipboard, add this to your
  tmux.conf:

  ```tmux
  set -g set-clipboard on
  ```

  With nested tmux you need it at every level. Without it, use the native
  selection path above instead, which does not depend on tmux at all.
- For OSC 52 writes to land, the browser must allow programmatic clipboard
  access. On a secure origin (https, or http on localhost) this is automatic.
  On an insecure origin (a plain http LAN address, or a reverse proxy without
  TLS) the browser blocks the async clipboard API, so Sip falls back to a
  legacy copy that runs on your next click or keypress. Serving over https is
  the way to get instant, gesture-free clipboard writes.
- Sip never answers OSC 52 read queries. A remote program cannot read your
  clipboard back through the terminal.

## Related Projects

- [Bubble Tea](https://github.com/charmbracelet/bubbletea) - The TUI framework Sip is built for
- [Wish](https://github.com/charmbracelet/wish) - SSH server for Bubble Tea apps (Sip's API is inspired by Wish)
- [TUIOS](https://github.com/Gaurav-Gosain/tuios) - Terminal window manager where Sip originated
- [xterm.js](https://xtermjs.org/) - Terminal emulator used in the browser
- [ttyd](https://github.com/tsl0922/ttyd) - Share terminal over the web (C implementation)

## License

MIT License - see [LICENSE](LICENSE) for details

## Acknowledgments

Sip is developed as part of the [TUIOS](https://github.com/Gaurav-Gosain/tuios) project and builds on the excellent work of the [Charm](https://charm.sh) team and the xterm.js community.
