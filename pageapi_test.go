package sip

import (
	"strings"
	"testing"
)

func capNames(caps []Capability) string {
	out := make([]string, 0, len(caps))
	for _, c := range caps {
		out = append(out, string(c))
	}
	return strings.Join(out, ",")
}

// TestPageAPIZeroGrantsWhatSipAlreadyGranted is the promise to every existing
// deployment: upgrading to a sip with capabilities in it hands the page not one
// call it did not already have.
func TestPageAPIZeroGrantsWhatSipAlreadyGranted(t *testing.T) {
	var p PageAPI
	if got, want := capNames(p.resolve()), "observe,input"; got != want {
		t.Fatalf("ASSERTION: the zero PageAPI grants %q, want %q", got, want)
	}
	if opts := p.clientOptions(); opts != nil {
		t.Fatalf("ASSERTION: the zero PageAPI puts %v in the page. It must put nothing", opts)
	}
}

// TestPageAPIGrantAdds checks a grant reaches the page and carries the default
// with it: granting one capability must not take the other two away.
func TestPageAPIGrantAdds(t *testing.T) {
	p := PageAPI{Grant: []Capability{CapAppearance, CapRead}}
	if got, want := capNames(p.resolve()), "observe,input,appearance,read"; got != want {
		t.Fatalf("ASSERTION: resolve = %q, want %q", got, want)
	}
	if got, want := strings.Join(p.clientOptions(), ","), "observe,input,appearance,read"; got != want {
		t.Fatalf("ASSERTION: the page gets %q, want %q", got, want)
	}
}

// TestPageAPIRevokeRemoves is the split the design turns on: a page that may
// repaint the terminal need not be a page that may type into it.
func TestPageAPIRevokeRemoves(t *testing.T) {
	p := PageAPI{Grant: []Capability{CapAppearance}, Revoke: []Capability{CapInput}}
	if got, want := capNames(p.resolve()), "observe,appearance"; got != want {
		t.Fatalf("ASSERTION: resolve = %q, want %q", got, want)
	}
}

// TestPageAPIRevokeWinsOverGrant pins the one rule for a capability named in
// both lists. It is the safe answer, and a deployment that writes both wants
// to be told the same thing every time.
func TestPageAPIRevokeWinsOverGrant(t *testing.T) {
	p := PageAPI{Grant: []Capability{CapClipboard}, Revoke: []Capability{CapClipboard}}
	if got, want := capNames(p.resolve()), "observe,input"; got != want {
		t.Fatalf("ASSERTION: resolve = %q, want %q", got, want)
	}
}

// TestPageAPIRevokeEverythingIsAnEmptyList checks the page can be left with
// nothing, and that the empty list still reaches it. An absent list means the
// default, so "no capabilities" has to travel as [] rather than as silence.
func TestPageAPIRevokeEverythingIsAnEmptyList(t *testing.T) {
	p := PageAPI{Revoke: AllCapabilities()}
	if got := p.resolve(); len(got) != 0 {
		t.Fatalf("ASSERTION: revoking everything leaves %v", got)
	}
	opts := p.clientOptions()
	if opts == nil {
		t.Fatal("ASSERTION: a page that grants nothing sends no list, so the client falls back to the default")
	}
	if len(opts) != 0 {
		t.Fatalf("ASSERTION: the page gets %v, want an empty list", opts)
	}
}

// TestPageAPIValidateRefusesAnUnknownName checks a misspelled capability is a
// refusal and not a silent denial. Grant would drop it, the page would go on
// being refused, and the deployment would read that as sip ignoring the field.
func TestPageAPIValidateRefusesAnUnknownName(t *testing.T) {
	for _, p := range []PageAPI{
		{Grant: []Capability{"appearence"}},
		{Revoke: []Capability{"typing"}},
	} {
		err := p.Validate()
		if err == nil {
			t.Fatalf("ASSERTION: %+v was accepted", p)
		}
		if !strings.Contains(err.Error(), "observe, input, appearance") {
			t.Errorf("ASSERTION: %q does not list the capabilities to choose from", err)
		}
	}
	if err := (PageAPI{Grant: AllCapabilities()}).Validate(); err != nil {
		t.Fatalf("ASSERTION: every capability sip defines was refused: %v", err)
	}
}

// TestServerRefusesAnUnknownCapability checks the refusal happens before a
// port is bound, the way a bad colour does.
func TestServerRefusesAnUnknownCapability(t *testing.T) {
	cfg := DefaultConfig()
	cfg.PageAPI.Grant = []Capability{"everything"}
	s := newHTTPServer(cfg, nil)
	err := s.validateConfig()
	if err == nil {
		t.Fatal("ASSERTION: the server started with a capability that does not exist")
	}
	if !strings.Contains(err.Error(), "pageAPI") {
		t.Errorf("ASSERTION: %q does not say which option was wrong", err)
	}
}

// TestRenderIndexPageAPI checks the list reaches the page under the key
// static/terminal.js reads. The key and the names are the contract.
func TestRenderIndexPageAPI(t *testing.T) {
	s := &httpServer{config: Config{PageAPI: PageAPI{
		Grant:  []Capability{CapAppearance},
		Revoke: []Capability{CapInput},
	}}}
	got := string(s.renderIndex([]byte("<head>{{FONT_FACE_EXTRA}}</head>")))
	if want := `"pageAPI":["observe","appearance"]`; !strings.Contains(got, want) {
		t.Fatalf("ASSERTION: the page is missing %s:\n%s", want, got)
	}

	// And the other half: a deployment that configured nothing puts no
	// capability list in its page at all.
	plain := &httpServer{config: DefaultConfig()}
	if body := string(plain.renderIndex([]byte("<head>{{FONT_FACE_EXTRA}}</head>"))); strings.Contains(body, "pageAPI") {
		t.Fatalf("ASSERTION: a page that configured nothing carries a capability list:\n%s", body)
	}
}

// TestDefaultCapabilitiesMatchTheClient guards the one table this feature
// duplicates.
//
// The client needs its own default list because a page sip did not render
// carries no config blob at all, and the fallback it uses then has to be the
// same set Go would have sent. Two copies drift, and the drift is invisible in
// the worst direction: the page would grant a capability the deployment never
// wrote down.
func TestDefaultCapabilitiesMatchTheClient(t *testing.T) {
	src, err := staticFiles.ReadFile("static/terminal.js")
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)

	for _, pair := range []struct {
		marker string
		caps   []Capability
	}{
		{"const CAP_ALL = [", AllCapabilities()},
		{"const CAP_DEFAULT = [", DefaultCapabilities()},
	} {
		start := strings.Index(body, pair.marker)
		if start < 0 {
			t.Fatalf("ASSERTION: %s is gone from static/terminal.js", pair.marker)
		}
		end := strings.Index(body[start:], "]")
		if end < 0 {
			t.Fatalf("ASSERTION: %s is not terminated", pair.marker)
		}
		list := body[start+len(pair.marker) : start+end]

		var names []string
		for _, part := range strings.Split(list, ",") {
			part = strings.TrimSpace(strings.Trim(strings.TrimSpace(part), "'"))
			if part != "" {
				names = append(names, part)
			}
		}
		if got, want := strings.Join(names, ","), capNames(pair.caps); got != want {
			t.Errorf("ASSERTION: the client's %s is %q, Go says %q", pair.marker, got, want)
		}
	}
}

// TestClientMouseCursorsMatchGo pins the four cursor keywords that are a
// deployment's to choose and a program's to do without.
//
// The client builds its allowlist from POINTER_SHAPES, which
// TestClientAndGoAgreeOnTheShapes already pins, so only the extras can drift.
// They matter because sip.appearance.set accepts the same vocabulary
// Appearance.MouseCursor does: a page told "use one of these" in Go and
// refused one of them in the browser has been told two different things.
func TestClientMouseCursorsMatchGo(t *testing.T) {
	src, err := staticFiles.ReadFile("static/terminal.js")
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	const marker = "const MOUSE_CURSORS_EXTRA = ["
	start := strings.Index(body, marker)
	if start < 0 {
		t.Fatal("ASSERTION: MOUSE_CURSORS_EXTRA is gone from static/terminal.js")
	}
	end := strings.Index(body[start:], "]")
	list := body[start+len(marker) : start+end]

	for _, name := range extraMouseCursors {
		if !strings.Contains(list, "'"+name+"'") {
			t.Errorf("ASSERTION: the client does not accept the %q cursor, which Go does", name)
		}
	}
	if got, want := strings.Count(list, "'")/2, len(extraMouseCursors); got != want {
		t.Errorf("ASSERTION: the client has %d extra cursors, Go has %d", got, want)
	}
	// And the set is derived rather than copied, so the thirty cannot drift.
	if !strings.Contains(body, "new Set([...POINTER_SHAPES, ...MOUSE_CURSORS_EXTRA])") {
		t.Error("ASSERTION: MOUSE_CURSORS no longer derives from POINTER_SHAPES, so the two lists can drift")
	}
}
