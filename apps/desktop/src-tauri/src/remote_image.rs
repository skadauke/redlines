//! The one picture a paste from Google Docs names by address, fetched for the page.
//!
//! Google Docs puts its pictures on the clipboard as `https://` addresses on its own image hosts,
//! which the page can't fetch (its content security policy allows none) and which a document
//! should not depend on staying alive. The page asks for them here, one at a time, and saves the
//! bytes through the same image saving a pasted screenshot goes through (`add_pasted_image`).
//!
//! The command is no general fetch. It takes `https` only, from the short list of Google's image
//! hosts in [`allowed`] (a redirect is held to the same list), sends no cookies and no credentials,
//! gives up after [`TIMEOUT`], reads no more than [`MAX_BYTES`], and hands back nothing unless the
//! content type is an image's and the first bytes are one of a picture the preview shows. The
//! page keeps its link and says so when this refuses, never silently.
//!
//! The fetch itself is written against [`Transport`], so the tests run it on a fake one and touch
//! no network.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use serde::Serialize;

/// The most bytes of a picture it takes (a Docs picture is far smaller; the host's own cap for any
/// image is larger).
pub(crate) const MAX_BYTES: u64 = 20 * 1024 * 1024;

/// How long a fetch may take, from the request to the last byte.
pub(crate) const TIMEOUT: Duration = Duration::from_secs(20);

/// How many redirects it follows, each to an address that is allowed too.
const MAX_REDIRECTS: usize = 3;

type Boxed<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// The answer to a request, read a chunk at a time so that the size cap stops the read.
pub(crate) trait Reply: Send {
    fn status(&self) -> u16;
    fn content_type(&self) -> Option<String>;
    fn content_length(&self) -> Option<u64>;
    fn chunk(&mut self) -> Boxed<'_, Result<Option<Vec<u8>>, String>>;
}

/// What makes a request: the real one is `reqwest`'s, a test's is a fake.
pub(crate) trait Transport: Sync {
    fn get(&self, url: &str) -> Boxed<'_, Result<Box<dyn Reply>, String>>;
}

/// A picture the page may save: its type, read from its bytes, and the bytes in base64.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteImage {
    pub mime_type: String,
    pub data: String,
}

/// Whether `url` is an address a picture may be fetched from: `https`, no user or password, the
/// default port, and a host of Google's image servers (`lh3.googleusercontent.com`,
/// `lh7-rt.googleusercontent.com`, `lh7-us.googleusercontent.com` and the like).
pub(crate) fn allowed(url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let Some(name) = host.strip_suffix(".googleusercontent.com") else {
        return false;
    };
    // `lh` and digits, then at most a few dash-separated labels of letters: `lh7`, `lh7-rt`.
    let mut parts = name.split('-');
    let first = parts.next().unwrap_or("");
    first.len() > 2
        && first.starts_with("lh")
        && first[2..].bytes().all(|b| b.is_ascii_digit())
        && parts.all(|p| !p.is_empty() && p.len() <= 4 && p.bytes().all(|b| b.is_ascii_lowercase()))
}

/// The type of a picture by its first bytes, among those the preview shows and the editor saves
/// (SVG is left out: it can carry script); None for any other bytes.
fn sniff(bytes: &[u8]) -> Option<&'static str> {
    match infer::get(bytes)?.mime_type() {
        t @ ("image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp") => Some(t),
        _ => None,
    }
}

/// The error the page is shown no text of: it keeps its link and says it couldn't save.
fn refuse<T>(why: &str) -> Result<T, String> {
    Err(why.to_string())
}

async fn fetch_inner(transport: &dyn Transport, url: &str) -> Result<RemoteImage, String> {
    use base64::Engine;
    if !allowed(url) {
        return refuse("That address isn’t one pictures are fetched from.");
    }
    let mut reply = transport.get(url).await?;
    if !(200..300).contains(&reply.status()) {
        return refuse("The picture isn’t there.");
    }
    let kind = reply
        .content_type()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !kind.trim_start().starts_with("image/") {
        return refuse("The address isn’t a picture.");
    }
    if reply.content_length().is_some_and(|n| n > MAX_BYTES) {
        return refuse("The picture is too large.");
    }
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = reply.chunk().await? {
        if bytes.len() as u64 + chunk.len() as u64 > MAX_BYTES {
            return refuse("The picture is too large.");
        }
        bytes.extend_from_slice(&chunk);
    }
    let Some(mime_type) = sniff(&bytes) else {
        return refuse("The address isn’t a picture.");
    };
    Ok(RemoteImage {
        mime_type: mime_type.to_string(),
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

/// Fetches the picture at `url` through `transport`, within [`TIMEOUT`].
pub(crate) async fn fetch(transport: &dyn Transport, url: &str) -> Result<RemoteImage, String> {
    match tokio::time::timeout(TIMEOUT, fetch_inner(transport, url)).await {
        Ok(result) => result,
        Err(_) => refuse("The picture took too long."),
    }
}

/// The real transport: `reqwest` with no cookies, no referrer and no credentials, which follows a
/// redirect only to an address that is allowed too.
struct Web;

struct WebReply(reqwest::Response);

impl Reply for WebReply {
    fn status(&self) -> u16 {
        self.0.status().as_u16()
    }
    fn content_type(&self) -> Option<String> {
        let value = self.0.headers().get(reqwest::header::CONTENT_TYPE)?;
        value.to_str().ok().map(str::to_string)
    }
    fn content_length(&self) -> Option<u64> {
        self.0.content_length()
    }
    fn chunk(&mut self) -> Boxed<'_, Result<Option<Vec<u8>>, String>> {
        Box::pin(async move {
            let chunk = self
                .0
                .chunk()
                .await
                .map_err(|_| "The picture didn’t come.".to_string())?;
            Ok(chunk.map(|bytes| bytes.to_vec()))
        })
    }
}

impl Transport for Web {
    fn get(&self, url: &str) -> Boxed<'_, Result<Box<dyn Reply>, String>> {
        let url = url.to_string();
        Box::pin(async move {
            // The same default provider the updater installs, for the same TLS.
            if rustls::crypto::CryptoProvider::get_default().is_none() {
                let _ = rustls::crypto::ring::default_provider().install_default();
            }
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if attempt.previous().len() >= MAX_REDIRECTS || !allowed(attempt.url().as_str())
                    {
                        attempt.stop()
                    } else {
                        attempt.follow()
                    }
                }))
                .referer(false)
                .timeout(TIMEOUT)
                .user_agent("Redlines")
                .build()
                .map_err(|_| "The picture didn’t come.".to_string())?;
            let reply = client
                .get(&url)
                .send()
                .await
                .map_err(|_| "The picture didn’t come.".to_string())?;
            Ok(Box::new(WebReply(reply)) as Box<dyn Reply>)
        })
    }
}

/// The picture at `url`, for a paste from Google Docs (see the module's note). Any failure is an
/// error, and the page keeps the address as a link.
#[tauri::command]
pub async fn fetch_remote_image(url: String) -> Result<RemoteImage, String> {
    fetch(&Web, &url).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
    const URL: &str = "https://lh7-rt.googleusercontent.com/docsz/AD_4nXe?key=abc";

    /// A reply of chunks, with the head a test gives it.
    struct Fake {
        status: u16,
        kind: Option<&'static str>,
        length: Option<u64>,
        chunks: Vec<Vec<u8>>,
    }

    impl Reply for Fake {
        fn status(&self) -> u16 {
            self.status
        }
        fn content_type(&self) -> Option<String> {
            self.kind.map(str::to_string)
        }
        fn content_length(&self) -> Option<u64> {
            self.length
        }
        fn chunk(&mut self) -> Boxed<'_, Result<Option<Vec<u8>>, String>> {
            Box::pin(async move {
                Ok(if self.chunks.is_empty() {
                    None
                } else {
                    Some(self.chunks.remove(0))
                })
            })
        }
    }

    /// A transport that answers once, and remembers what it was asked.
    struct Canned {
        reply: Mutex<Option<Fake>>,
        asked: Mutex<Vec<String>>,
        hang: bool,
    }

    impl Transport for Canned {
        fn get(&self, url: &str) -> Boxed<'_, Result<Box<dyn Reply>, String>> {
            self.asked.lock().unwrap().push(url.to_string());
            Box::pin(async move {
                if self.hang {
                    std::future::pending::<()>().await;
                }
                let reply = self.reply.lock().unwrap().take().ok_or("no reply")?;
                Ok(Box::new(reply) as Box<dyn Reply>)
            })
        }
    }

    fn canned(reply: Fake) -> Canned {
        Canned {
            reply: Mutex::new(Some(reply)),
            asked: Mutex::new(vec![]),
            hang: false,
        }
    }

    fn ok(chunks: Vec<Vec<u8>>) -> Fake {
        Fake {
            status: 200,
            kind: Some("image/png"),
            length: None,
            chunks,
        }
    }

    fn run<T>(test: impl Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .start_paused(true)
            .build()
            .unwrap()
            .block_on(test)
    }

    #[test]
    fn allows_only_https_on_googles_image_hosts() {
        for yes in [
            URL,
            "https://lh3.googleusercontent.com/abc",
            "https://lh7-us.googleusercontent.com/docsz/x",
            "https://LH5.googleusercontent.com/x",
        ] {
            assert!(allowed(yes), "{yes}");
        }
        for no in [
            "http://lh3.googleusercontent.com/abc",
            "https://googleusercontent.com/abc",
            "https://evil.com/lh3.googleusercontent.com",
            "https://lh3.googleusercontent.com.evil.com/abc",
            "https://evillh3.googleusercontent.com/abc",
            "https://lh.googleusercontent.com/abc",
            "https://docs.google.com/docs-images-rt/x",
            "https://lh3.googleusercontent.com:8443/abc",
            "https://user:pw@lh3.googleusercontent.com/abc",
            "https://127.0.0.1/abc",
            "https://[::1]/abc",
            "file:///etc/passwd",
            "data:image/png;base64,AAAA",
            "not a url",
            "",
        ] {
            assert!(!allowed(no), "{no}");
        }
    }

    #[test]
    fn fetches_a_picture_and_says_its_type_from_its_bytes() {
        use base64::Engine;
        let transport = canned(ok(vec![PNG[..4].to_vec(), PNG[4..].to_vec()]));
        let image = run(fetch(&transport, URL)).unwrap();
        assert_eq!(image.mime_type, "image/png");
        assert_eq!(transport.asked.lock().unwrap().as_slice(), [URL]);
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(image.data)
                .unwrap(),
            PNG
        );
    }

    #[test]
    fn a_disallowed_address_never_reaches_the_transport() {
        let transport = canned(ok(vec![PNG.to_vec()]));
        assert!(run(fetch(&transport, "https://example.com/a.png")).is_err());
        assert!(transport.asked.lock().unwrap().is_empty());
    }

    #[test]
    fn refuses_a_reply_that_is_not_ok_or_not_an_image() {
        let status = Fake {
            status: 404,
            ..ok(vec![PNG.to_vec()])
        };
        assert!(run(fetch(&canned(status), URL)).is_err());
        let html = Fake {
            kind: Some("text/html; charset=utf-8"),
            ..ok(vec![PNG.to_vec()])
        };
        assert!(run(fetch(&canned(html), URL)).is_err());
        let none = Fake {
            kind: None,
            ..ok(vec![PNG.to_vec()])
        };
        assert!(run(fetch(&canned(none), URL)).is_err());
    }

    #[test]
    fn refuses_bytes_that_are_no_picture_whatever_the_type_says() {
        let text = ok(vec![b"<html>not a picture</html>".to_vec()]);
        assert!(run(fetch(&canned(text), URL)).is_err());
        let svg = Fake {
            kind: Some("image/svg+xml"),
            ..ok(vec![
                b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>".to_vec(),
            ])
        };
        assert!(run(fetch(&canned(svg), URL)).is_err());
    }

    #[test]
    fn takes_the_type_from_the_bytes_when_the_header_is_wrong() {
        let jpeg = Fake {
            kind: Some("image/png"),
            ..ok(vec![vec![0xff, 0xd8, 0xff, 0xe0, 0, 0]])
        };
        assert_eq!(
            run(fetch(&canned(jpeg), URL)).unwrap().mime_type,
            "image/jpeg"
        );
    }

    #[test]
    fn holds_the_size_cap_by_the_header_and_by_the_bytes() {
        let said = Fake {
            length: Some(MAX_BYTES + 1),
            ..ok(vec![PNG.to_vec()])
        };
        assert!(run(fetch(&canned(said), URL)).is_err());
        // A header that lies: the chunks themselves are counted, and the read stops.
        let big = vec![0u8; (MAX_BYTES / 4 + 1) as usize];
        let lied = Fake {
            length: Some(10),
            ..ok(vec![
                PNG.to_vec(),
                big.clone(),
                big.clone(),
                big.clone(),
                big,
            ])
        };
        assert!(run(fetch(&canned(lied), URL)).is_err());
        // Exactly the cap is taken.
        let mut exact = PNG.to_vec();
        exact.resize(MAX_BYTES as usize, 0);
        assert!(run(fetch(&canned(ok(vec![exact])), URL)).is_ok());
    }

    #[test]
    fn gives_up_after_the_timeout() {
        let transport = Canned {
            hang: true,
            ..canned(ok(vec![]))
        };
        let error = run(fetch(&transport, URL)).unwrap_err();
        assert!(error.contains("too long"));
    }
}
