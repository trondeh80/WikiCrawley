let visitedUrls = new Set();
let completedUrls = new Set();
let urlQueue = [];
let baseDomain = "";
let tab = {};
let startUrl;
let currentUrl;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "startCrawl") {
    startUrl = message.url;
    tab.id = message.tabId;
    tab.url = startUrl;
    currentUrl = startUrl;

    baseDomain = new URL(startUrl).origin;
    visitedUrls = new Set();
    completedUrls = new Set();
    urlQueue = [startUrl];
    crawlNext();
  }

  if (message.type === "enqueueLinks") {
    for (const link of message.links) {
      if (!visitedUrls.has(link)) {
        urlQueue.push(link);
        visitedUrls.add(link);
      }
    }
    crawlNext();
  }
});

// Add this listener at the top level of your background.js
// It needs to be defined once and persist throughout the service worker's lifecycle.
chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Check if the navigation completed in the tab we're actively crawling
  // and if the URL matches the one we're expecting to crawl.
  // Also, make sure it's the main frame (not an iframe).
  if (
    details.tabId === tab.id
    // details.url === tab.url &&
    // details.frameId === 0
  ) {
    console.log("Page loaded and navigation completed for:", details.url);
    // Now it's safe to execute your content extraction script
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fetchAndSendHtml,
        args: [baseDomain], // baseDomain must be accessible here or passed via a global for the service worker
      });
      console.log("fetchAndSendHtml executed for:", details.url);
    } catch (error) {
      console.error("Error executing fetchAndSendHtml:", error);
      // Handle error, maybe re-queue or skip this URL
      crawlNext(); // Try the next URL if this one failed
    }
  }
});

async function crawlNext() {
  const nextUrl = urlQueue.find((url) => !completedUrls.has(url));
  if (!nextUrl) {
    console.log("✅ Crawl complete.");
    return;
  }

  console.log("Crawling " + nextUrl);
  completedUrls.add(nextUrl);


  if (isSameUrlOrWithHash(currentUrl, nextUrl)) {
    // Wait for page to load before injecting
    chrome.scripting
      .executeScript({
        target: { tabId: tab.id },
        func: () => {
          return new Promise((resolve) => {
            if (document.readyState === "complete") resolve();
            else
              window.addEventListener("load", () => resolve(), { once: true });
          });
        },
      })
      .then(() => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: fetchAndSendHtml,
          args: [baseDomain],
        });
      });
  } else {
    // Change URL and let WebNavigation handle the eventg
    await chrome.tabs.update(tab.id, { url: nextUrl });
  }
  currentUrl = nextUrl;
}

function fetchAndSendHtml(baseDomain) {
  const html = document.documentElement.outerHTML;

  fetch("http://localhost:1337", {
    method: "POST",
    headers: {
      "Content-Type": "text/html",
    },
    body: html,
  }).catch(console.error);

  const currentUrl = location.href;

  const links = Array.from(document.querySelectorAll("a"))
    .map((a) => a.href)
    .filter((href) => {
      try {
        const url = new URL(href);
        return url.origin === baseDomain && href !== currentUrl;
      } catch {
        return false;
      }
    });

  chrome.runtime.sendMessage({ type: "enqueueLinks", links });
}


function isSameUrlOrWithHash(currentUrl, nextUrl) {
  try {
    const current = new URL(currentUrl);
    const next = new URL(nextUrl);

    const sameBase =
      current.origin === next.origin &&
      current.pathname === next.pathname &&
      current.search === next.search;

    return sameBase;
  } catch (e) {
    return false;
  }
}