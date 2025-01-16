const ENV = {
  development: {
    API_URL: "http://localhost:3000",
    WEB_URL: "http://localhost:3000",
    allowedOrigins: ["http://localhost:3000/*"],
  },
  production: {
    API_URL: "https://www.getgistr.com",
    WEB_URL: "https://www.getgistr.com",
    allowedOrigins: ["https://*.getgistr.com/*"],
  },
};

// Determine environment based on extension URL or manifest
const isDevelopment = !chrome.runtime.getManifest().update_url;
const config = ENV[isDevelopment ? "development" : "production"];

async function refreshArticleList() {
  const tabs = await chrome.tabs.query({
    url: config.allowedOrigins,
  });

  // If articles page is open, refresh it
  tabs.forEach((tab) => {
    chrome.tabs.reload(tab.id);
  });
}

// Keep only last 50 summaries in storage
async function cleanupStorage() {
  const { summaries = {} } = await chrome.storage.local.get("summaries");
  const entries = Object.entries(summaries);

  if (entries.length > 50) {
    // Sort by timestamp (assuming your processedArticle has a timestamp)
    const sortedEntries = entries.sort((a, b) => {
      return (b[1].timestamp || 0) - (a[1].timestamp || 0);
    });

    const trimmedSummaries = Object.fromEntries(
      sortedEntries.slice(0, 50) // Keep first 50 after sorting
    );

    await chrome.storage.local.set({ summaries: trimmedSummaries });
  }
}

function createArticlePreview(processedArticle) {
  const preview = document.createElement("div");
  preview.innerHTML = `
      <div class="flex flex-col gap-1">
        <h2 class="font-semibold text-lg">${
          processedArticle.title || "Untitled"
        }</h2>
        ${
          processedArticle.author
            ? `<p class="mt-0 text-sm text-gray-500">By ${processedArticle.author}</p>`
            : ""
        }
        <div class="flex items-center gap-2 text-sm text-gray-500">
          <span>${processedArticle.word_count} words | ${
    processedArticle.read_time
  } min read</span>
        </div>
      </div>
      <p class="text-sm text-gray-600">${processedArticle.summary}</p>
      <div class="flex items-center gap-2 text-sm text-gray-500">
        ${
          processedArticle.tags
            ? `
          <div class="flex gap-2 flex-wrap">
            ${processedArticle.tags
              .split(",")
              .map(
                (tag) =>
                  `<span class="bg-gray-100 px-2 py-0.5 rounded-full">${tag.trim()}</span>`
              )
              .join("")}
          </div>
        `
            : ""
        }
      </div>
    `;
  return preview;
}

document.addEventListener("DOMContentLoaded", async () => {
  chrome.storage.local.getBytesInUse(null, function (bytesUsed) {
    console.log(`Storage used: ${bytesUsed / 1024}KB of 10MB`);
  });

  // Check if we have tokens
  const { supabaseAccessToken, supabaseRefreshToken } =
    await chrome.storage.local.get([
      "supabaseAccessToken",
      "supabaseRefreshToken",
    ]);

  const loginSection = document.getElementById("loginSection");
  const articleSection = document.getElementById("articleSection");
  const statusElement = document.getElementById("status");
  const summarizeButton = document.getElementById("summarizeButton");
  const loginButton = document.getElementById("loginButton");

  if (!supabaseAccessToken) {
    // Show login UI
    loginSection.style.display = "block";
    articleSection.style.display = "none";
  } else {
    // Show article UI
    loginSection.style.display = "none";
    articleSection.style.display = "block";

    // Try to load cached summary for current tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab.url) {
      const { summaries = {} } = await chrome.storage.local.get("summaries");
      const cachedSummary = summaries[tab.url];

      if (cachedSummary) {
        const currentArticle = document.getElementById("currentArticle");
        currentArticle.innerHTML = "";
        currentArticle.appendChild(createArticlePreview(cachedSummary));
        summarizeButton.remove();
      }
    }
  }

  loginButton.addEventListener("click", () => {
    // go trigger web app to send tokens to this chrome extension
    window.open(`${config.WEB_URL}/login/extension`);
  });

  summarizeButton.addEventListener("click", async () => {
    // Disable button and update text
    summarizeButton.disabled = true;
    summarizeButton.textContent = "Summarizing...";

    const { supabaseAccessToken, supabaseRefreshToken } =
      await chrome.storage.local.get([
        "supabaseAccessToken",
        "supabaseRefreshToken",
      ]);

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.url) return;

    try {
      const response = await fetch(`${config.API_URL}/api/articles`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseAccessToken}`,
          "X-Refresh-Token": supabaseRefreshToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: tab.url,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 401) {
          // Token expired or invalid - clear tokens and show login
          await chrome.storage.local.set({
            supabaseAccessToken: null,
            supabaseRefreshToken: null,
          });
          loginSection.style.display = "block";
          articleSection.style.display = "none";
        }
        throw new Error(error.error);
      }

      const article = await response.json();

      // Add missing fields before refreshing
      const processedArticle = {
        ...article,
        timestamp: Date.now(),
        read_time: Math.ceil(article.word_count / 238),
      };

      console.log(processedArticle);

      // First cleanup storage
      await cleanupStorage();

      // Cache the summary
      const { summaries = {} } = await chrome.storage.local.get("summaries");
      await chrome.storage.local.set({
        summaries: {
          ...summaries,
          [tab.url]: processedArticle,
        },
      });

      const currentArticle = document.getElementById("currentArticle");
      currentArticle.innerHTML = "";
      currentArticle.appendChild(createArticlePreview(processedArticle));
      summarizeButton.remove();

      statusElement.textContent = "Article saved successfully!";
      statusElement.className = "text-sm text-green-600";

      refreshArticleList();
    } catch (error) {
      statusElement.textContent = "Error summarizing article: " + error.message;
      statusElement.className = "text-sm text-red-600";
    } finally {
      // Reset button state
      summarizeButton.disabled = false;
      summarizeButton.textContent = "Summarize Article";
    }
  });
});
