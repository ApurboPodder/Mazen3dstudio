(() => {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(new URL("service-worker.js", document.baseURI).href, { scope: new URL(".", document.baseURI).pathname })
      .catch((error) => console.warn("Model Studio could not register its offline worker", error));
  }, { once: true });
})();
