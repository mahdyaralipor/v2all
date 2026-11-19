import React, { useEffect } from "react";
import { enhancePage } from "./interactions";

export const SUBSCRIPTION_URL =
  "https://raw.githubusercontent.com/mahdyaralipor/v2all/main/real_sub.txt";

const REPOSITORY = "https://github.com/mahdyaralipor/v2all";

function Arrow({ direction = "out" }: { direction?: "out" | "up" }) {
  return (
    <svg
      className={`arrow arrow--${direction}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      {direction === "out" ? (
        <path d="M4 12 12 4M4 4h8v8" />
      ) : (
        <path d="M8 13V3M3 8l5-5 5 5" />
      )}
    </svg>
  );
}

function RegisterMark() {
  return <span className="register-mark" aria-hidden="true" />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="eyebrow section-label">
      <RegisterMark />
      {children}
    </p>
  );
}

const steps = [
  {
    name: "Collect",
    description:
      "Fetch the public lists. Remove duplicates and non-routable IPs.",
  },
  {
    name: "Connect",
    description:
      "TCP-check each host and port. Reachable isn't the same as working.",
  },
  {
    name: "Prove it",
    description:
      "Start Xray. Fetch a URL through the proxy. No traffic, no subscription.",
  },
  {
    name: "Publish",
    description:
      "Normalize the surviving links. Rebuild the subscription every 6 hours in CI.",
  },
];

export default function App() {
  useEffect(() => enhancePage(document), []);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header page-grid" id="top">
        <a className="small-wordmark" href="#top" aria-label="v2all home">
          <RegisterMark />
          v2all
        </a>
        <a
          className="text-link source-link"
          href={REPOSITORY}
          target="_blank"
          rel="noopener noreferrer"
        >
          Read the source <Arrow />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="hero page-grid" aria-labelledby="product-name">
          <p className="eyebrow hero-kicker">
            Public V2Ray configs. Filtered by traffic.
          </p>
          <div className="wordmark-bleed">
            <h1 className="wordmark" id="product-name" aria-label="v2all">
              <span className="wordmark-name">v2all</span>
              <span className="wordmark-cursor" aria-hidden="true" />
            </h1>
          </div>
          <div className="hero-pause" aria-hidden="true" />
          <div className="hero-intro">
            <h2 className="hero-headline">
              Dead configs
              <br />
              stay out.
            </h2>
          </div>
          <div className="subscription" id="subscription">
            <p className="hero-description">
              Public config lists in. One subscription out.
              <br className="desktop-break" /> If it can't proxy traffic, it
              doesn't make the cut.
            </p>
            <div className="subscription-control">
              <label className="eyebrow" htmlFor="subscription-url">
                Subscription URL
              </label>
              <div className="copy-control">
                <textarea
                  id="subscription-url"
                  className="subscription-url"
                  rows={2}
                  readOnly
                  value={SUBSCRIPTION_URL}
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby="subscription-help"
                  data-subscription-url
                />
                <button
                  className="copy-button"
                  type="button"
                  aria-label="Copy the v2all subscription URL to clipboard"
                  data-copy-subscription
                  hidden
                >
                  <span data-copy-label>Copy subscription</span>
                </button>
              </div>
              <p className="client-note" id="subscription-help">
                Add as a subscription in v2rayNG, Hiddify, or v2rayN.
              </p>
              <p
                className="copy-status"
                id="copy-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              />
              <noscript>
                <p className="manual-copy-note">
                  Select the URL above and copy it into your client.
                </p>
              </noscript>
            </div>
          </div>
        </section>

        <section
          className="filter-section page-grid"
          aria-labelledby="filter-title"
        >
          <div className="section-intro" data-reveal>
            <SectionLabel>The filter</SectionLabel>
            <h2 className="section-heading" id="filter-title">
              An open port
              <br />
              isn't proof.
            </h2>
            <p className="section-description">
              <span className="measurement">22 auto-updated sources.</span>{" "}
              <span className="measurement">About 10,000 links scanned.</span>{" "}
              Only configs that complete a real Xray handshake survive.
            </p>
          </div>
          <ol className="process-list">
            {steps.map((step, index) => (
              <li className="process-row" key={step.name} data-reveal>
                <span className="step-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{step.name}</h3>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="objection-section page-grid"
          aria-labelledby="catch-title"
        >
          <div className="section-intro" data-reveal>
            <SectionLabel>The catch</SectionLabel>
            <h2 className="section-heading" id="catch-title">
              CI isn't your network.
            </h2>
          </div>
          <div className="objection-body" data-reveal>
            <p>
              A CI handshake isn't a test of your network. Public servers can
              disappear. Refresh the subscription if a connection fails. These
              are third-party proxies; don't use them for sensitive traffic.
            </p>
            <div className="command-area">
              <div className="local-command">
                <p className="eyebrow">Run the test on your network</p>
                <pre>
                  <span className="command-prompt" aria-hidden="true">
                    ${" "}
                  </span>
                  <code>./v2all.py --pool 300 --top 30</code>
                </pre>
                <p className="requirements">
                  Python 3.8+ <span aria-hidden="true">/</span> curl{" "}
                  <span aria-hidden="true">/</span> gh for publishing
                </p>
              </div>
              <a
                className="text-link setup-link"
                href={`${REPOSITORY}#requirements`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Read the setup instructions <Arrow />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer page-grid">
        <p className="footer-signoff">
          <RegisterMark />
          <span className="footer-brand">v2all</span>
        </p>
        <a
          className="license-link"
          href={`${REPOSITORY}#license`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open source. MIT license.
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <a
          className="text-link back-link"
          href="#subscription"
          data-back-to-subscription
        >
          Back to subscription <Arrow direction="up" />
        </a>
      </footer>
    </>
  );
}
