package sip

import "context"

// Identity is the minimal contract for authenticated subjects produced
// by ConnectMiddleware. The interface is intentionally tiny so any
// auth implementation can satisfy it cheaply.
type Identity interface {
	String() string
}

type identityCtxKey struct{}

// WithIdentity returns a derived context carrying id. Passing nil
// returns ctx unchanged.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	if id == nil {
		return ctx
	}
	return context.WithValue(ctx, identityCtxKey{}, id)
}

// IdentityFromContext returns the Identity attached to ctx, if any.
func IdentityFromContext(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityCtxKey{}).(Identity)
	return id, ok
}

type remoteAddrCtxKey struct{}

// WithRemoteAddr returns a derived context carrying the client's
// remote address. Empty addr returns ctx unchanged.
func WithRemoteAddr(ctx context.Context, addr string) context.Context {
	if addr == "" {
		return ctx
	}
	return context.WithValue(ctx, remoteAddrCtxKey{}, addr)
}

// RemoteAddrFromContext returns the remote address attached to ctx,
// or "" if none.
func RemoteAddrFromContext(ctx context.Context) string {
	s, _ := ctx.Value(remoteAddrCtxKey{}).(string)
	return s
}
