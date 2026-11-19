export function enhancePage(doc: Document) {
  const button = doc.querySelector<HTMLButtonElement>(
    "[data-copy-subscription]",
  );
  const field = doc.querySelector<HTMLTextAreaElement>(
    "[data-subscription-url]",
  );
  const status = doc.querySelector<HTMLElement>("#copy-status");
  const label = doc.querySelector<HTMLElement>("[data-copy-label]");
  const backLink = doc.querySelector<HTMLAnchorElement>(
    "[data-back-to-subscription]",
  );
  if (!button || !field || !status || !label) return;

  const root = doc.documentElement;
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let disposed = false;
  root.classList.add("is-enhanced");
  button.hidden = false;

  function fitUrl() {
    field!.style.height = "auto";
    field!.style.height = `${field!.scrollHeight}px`;
  }

  function selectUrl() {
    field!.focus({ preventScroll: true });
    field!.select();
    field!.setSelectionRange(0, field!.value.length);
  }

  function legacyCopy() {
    const previousFocus = doc.activeElement as HTMLElement | null;
    selectUrl();
    const copied = doc.execCommand("copy");
    if (copied) previousFocus?.focus({ preventScroll: true });
    return copied;
  }

  async function copySubscription() {
    if (pending) return;
    pending = true;
    clearTimeout(resetTimer);
    button!.setAttribute("aria-busy", "true");
    button!.dataset.state = "ready";
    label!.textContent = "Copy subscription";
    status!.removeAttribute("data-state");
    status!.textContent = "";
    let copied = false;
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(field!.value);
        copied = true;
      } else {
        copied = legacyCopy();
      }
    } catch {
      try {
        copied = legacyCopy();
      } catch {
        copied = false;
      }
    }
    pending = false;
    if (disposed) return;
    button!.removeAttribute("aria-busy");
    if (copied) {
      button!.dataset.state = "copied";
      label!.textContent = "Copied";
      status!.textContent = "Copied. Now paste it into your client.";
      status!.dataset.state = "success";
      resetTimer = setTimeout(() => {
        button!.dataset.state = "ready";
        label!.textContent = "Copy subscription";
      }, 3000);
    } else {
      selectUrl();
      status!.textContent = "Copy unavailable. Select and copy the URL above.";
      status!.dataset.state = "error";
    }
  }

  function focusSubscription() {
    // Keep native anchor navigation and move keyboard focus to its destination.
    requestAnimationFrame(() => field!.focus({ preventScroll: true }));
  }

  fitUrl();
  button.addEventListener("click", copySubscription);
  field.addEventListener("click", selectUrl);
  window.addEventListener("resize", fitUrl);
  backLink?.addEventListener("click", focusSubscription);

  let observer: IntersectionObserver | undefined;
  const reveals = [...doc.querySelectorAll<HTMLElement>("[data-reveal]")];
  if (!motionQuery.matches && "IntersectionObserver" in window) {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.remove("will-reveal");
            observer?.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -24px 0px" },
    );

    reveals.forEach((element, index) => {
      if (element.getBoundingClientRect().top > window.innerHeight) {
        element.classList.add("will-reveal");
        element.style.setProperty("--reveal-delay", `${(index % 4) * 30}ms`);
        observer!.observe(element);
      }
    });
  }

  function updateMotionPreference() {
    if (motionQuery.matches) {
      observer?.disconnect();
      reveals.forEach((element) => element.classList.remove("will-reveal"));
    }
  }
  motionQuery.addEventListener("change", updateMotionPreference);

  return () => {
    disposed = true;
    clearTimeout(resetTimer);
    observer?.disconnect();
    button.removeEventListener("click", copySubscription);
    field.removeEventListener("click", selectUrl);
    window.removeEventListener("resize", fitUrl);
    backLink?.removeEventListener("click", focusSubscription);
    motionQuery.removeEventListener("change", updateMotionPreference);
    reveals.forEach((element) => element.classList.remove("will-reveal"));
    root.classList.remove("is-enhanced");
  };
}
