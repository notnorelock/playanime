// PlayAnime CDN — serves uploaded media (avatars today; anything else that
// needs a real file upload later) from a shared volume, at cdn.playani.me.
//
// Deliberately minimal: this is a read-only static file server, not a
// second copy of the API. The API (packages/api) is the only thing that
// ever writes into the shared volume this serves from — it owns auth,
// validates uploads, and decides the final file path. This service never
// sees a session cookie or a database connection; it only serves whatever
// the API already wrote. That split is what keeps this container safe to
// expose on its own subdomain with no auth of its own: there is nothing
// here to authorize, only files that were already approved to exist.
//
// Standard library only (net/http), not gin — a static file server has no
// routing/middleware complexity that would justify the dependency, and
// http.FileServer already implements correct ETag/If-Modified-Since/Range
// handling, which a hand-rolled handler would have to reimplement to match.
package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// http.FileServer auto-generates a directory listing for any request path
// that resolves to a real directory with no index.html — before this
// service ever stored nested paths (avatars/<userId>/<hash>_<size>.webp),
// that had nothing to list, so the behavior sat dormant. It became a real
// information leak the moment nested per-user directories existed: browsing
// /avatars/ lists every user id that has uploaded an avatar, and browsing
// into one lists every file hash they have — not the file *contents* (still
// unguessable random names), but real user ids and how many uploads each
// has, which a mostly-static-file CDN should never hand out. Rejected by
// checking whether the resolved filesystem path is a directory before ever
// handing the request to http.FileServer; a request for a real file still
// passes straight through.
func rejectDirectoryListing(root string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cleaned := filepath.Clean(r.URL.Path)
		info, err := os.Stat(filepath.Join(root, cleaned))
		if err == nil && info.IsDir() {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	root := os.Getenv("CDN_ROOT")
	if root == "" {
		root = "/data"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3100"
	}

	absRoot, err := filepath.Abs(root)
	if err != nil {
		log.Fatalf("resolving CDN_ROOT %q: %v", root, err)
	}

	fileServer := http.FileServer(http.Dir(absRoot))

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	mux.Handle("/", withCacheHeaders(rejectDotfiles(rejectDirectoryListing(absRoot, fileServer))))

	addr := ":" + port
	log.Printf("cdn serving %s on %s", absRoot, addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("cdn server failed: %v", err)
	}
}

// Every uploaded file's name is a server-generated random id (see the API's
// upload handler), never a user-supplied filename — so a leading dot is
// never a legitimate real file, only path-probing for something like
// .env or .git that has no business being under this root in the first
// place. Refused outright rather than trusted to http.FileServer's own
// directory-listing behavior.
func rejectDotfiles(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, segment := range strings.Split(r.URL.Path, "/") {
			if strings.HasPrefix(segment, ".") && segment != "" {
				http.NotFound(w, r)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// Uploaded media is immutable once written (the API writes each upload
// under a fresh random filename rather than overwriting one in place — see
// its upload handler), so a long, cacheable, immutable response is always
// correct: there is no version of this exact URL that will ever change
// out from under a cache holding it.
func withCacheHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		next.ServeHTTP(w, r)
	})
}
