// Simple example showing how to serve a Bubble Tea app through the browser.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"

	"github.com/Gaurav-Gosain/sip"
)

// model is a simple counter that demonstrates the basic Sip API.
type model struct {
	count  int
	width  int
	height int
}

func (m model) Init() tea.Cmd {
	return nil
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, tea.Quit
		case "up", "k":
			m.count++
		case "down", "j":
			m.count--
		case "r":
			m.count = 0
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

func (m model) View() tea.View {
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		Padding(1, 2).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("63"))

	content := fmt.Sprintf("Count: %d\n\n↑/k: increment\n↓/j: decrement\nr: reset\nq: quit", m.count)

	return tea.NewView(lipgloss.Place(
		m.width, m.height,
		lipgloss.Center, lipgloss.Center,
		style.Render(content),
	))
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	config := sip.DefaultConfig()
	config.Debug = true

	server := sip.NewServer(config)

	fmt.Println("Starting server at http://localhost:7681")

	err := server.Serve(ctx, func(sess sip.Session) (tea.Model, []tea.ProgramOption) {
		pty := sess.Pty()
		return model{width: pty.Width, height: pty.Height}, nil
	})

	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
