//! Shared HTTP clients.
//!
//! A `reqwest::Client` holds a connection pool. Building a fresh one per
//! command (as the Graph client used to) means a new TCP + TLS handshake to
//! graph.microsoft.com for every click. These clients are built once and
//! cloned (a clone is a cheap `Arc` bump that shares the pool).

use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

/// Client for Microsoft Graph and the Microsoft login endpoint.
///
/// No overall timeout (an attachment download may legitimately take minutes),
/// but a connect and a per-read timeout, so a dead connection fails instead of
/// hanging the command forever.
pub fn api() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .read_timeout(Duration::from_secs(90))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new())
        })
        .clone()
}

/// Client for external images in e-mails (`fetch_remote_image`).
///
/// The URL comes from an e-mail, so from a stranger. This client only talks
/// to public internet addresses: without that, a message could make the app
/// send requests to the router, a NAS or a service on localhost (SSRF), also
/// through a redirect or a hostname that resolves to a private address.
pub fn remote_images() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            let policy = reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 {
                    attempt.error("Te veel omleidingen.")
                } else if !is_public_url(attempt.url()) {
                    attempt.error("Omleiding naar een niet-openbaar adres geweigerd.")
                } else {
                    attempt.follow()
                }
            });
            reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .redirect(policy)
                // No referer on redirects: it would leak the source URL.
                .referer(false)
                // Hostnames are checked after resolving (covers DNS names that
                // point at 127.0.0.1 or 192.168.x.x).
                .dns_resolver(Arc::new(PublicOnlyResolver))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new())
        })
        .clone()
}

/// Whether `url` may be fetched on behalf of an e-mail: http(s) only, and an
/// IP literal must be a public address. Hostnames are checked by
/// [`PublicOnlyResolver`] once they resolve (reqwest skips the resolver for
/// IP literals, hence this separate check).
pub fn is_public_url(url: &url::Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    match url.host() {
        Some(url::Host::Ipv4(ip)) => is_public_ip(IpAddr::V4(ip)),
        Some(url::Host::Ipv6(ip)) => is_public_ip(IpAddr::V6(ip)),
        Some(url::Host::Domain(_)) => true,
        None => false,
    }
}

/// True for addresses on the public internet; false for loopback, private
/// ranges, link-local (including cloud metadata at 169.254.169.254), CGNAT,
/// multicast and the like.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_documentation()
                || o[0] == 0
                || (o[0] == 100 && (o[1] & 0xC0) == 64) // 100.64.0.0/10 (CGNAT)
                || o[0] >= 224) // multicast + reserved
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (first & 0xFE00) == 0xFC00 // fc00::/7 (unique local)
                || (first & 0xFFC0) == 0xFE80) // fe80::/10 (link-local)
        }
    }
}

/// DNS resolver that drops every non-public address. A name that only
/// resolves to private addresses fails to connect.
struct PublicOnlyResolver;

impl reqwest::dns::Resolve for PublicOnlyResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            // The port is replaced by the connector; 0 is a placeholder.
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await?
                .filter(|a| is_public_ip(a.ip()))
                .collect();
            if addrs.is_empty() {
                return Err(format!("{host} is geen openbaar adres.").into());
            }
            Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn public(s: &str) -> bool {
        is_public_ip(s.parse().unwrap())
    }

    #[test]
    fn private_and_local_addresses_are_refused() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "::1",
            "fe80::1",
            "fd00::1",
            "::ffff:192.168.1.1",
        ] {
            assert!(!public(ip), "{ip} should not count as public");
        }
    }

    #[test]
    fn public_addresses_are_allowed() {
        for ip in ["8.8.8.8", "20.190.160.1", "2606:4700::1111", "100.128.0.1"] {
            assert!(public(ip), "{ip} should count as public");
        }
    }

    #[test]
    fn url_literals_are_checked() {
        let ok = |s: &str| is_public_url(&url::Url::parse(s).unwrap());
        assert!(ok("https://example.com/pixel.gif"));
        assert!(!ok("http://127.0.0.1:8080/x.png"));
        assert!(!ok("http://[::1]/x.png"));
        assert!(!ok("http://192.168.1.1/cgi-bin/reboot"));
        assert!(!ok("file:///C:/Windows/win.ini"));
    }
}
