const ENV = {
  development: {
    API_URL: "http://localhost:3000",
    WEB_URL: "http://localhost:3000",
    allowedOrigins: ["http://localhost:3000/*"],
  },
  production: {
    API_URL: "https://app.getgistr.com",
    WEB_URL: "https://app.getgistr.com",
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
  preview.className = "flex flex-col gap-4";
  preview.innerHTML = `
      <div class="flex flex-col gap-2">
        <h2 class="heading">${processedArticle.title || "Untitled"}</h2>
        ${
          processedArticle.author
            ? `<p class="author-line">
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  width="14" 
                  height="14" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  stroke-width="2" 
                  stroke-linecap="round" 
                  stroke-linejoin="round"
                  class="author-icon"
                >
                  <circle cx="12" cy="8" r="5"/>
                  <path d="M20 21a8 8 0 1 0-16 0"/>
                </svg>
                <span>${processedArticle.author}</span>
              </p>`
            : ""
        }
      </div>
      <p class="text-sm text-muted-foreground">${processedArticle.summary}</p>
      <div class="flex items-center gap-2 text-sm">
        <div class="flex items-center gap-1">
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width="14" 
            height="14" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            stroke-width="2" 
            stroke-linecap="round" 
            stroke-linejoin="round"
            class="text-muted-foreground"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span class="text-muted-foreground">${processedArticle.word_count.toLocaleString()} words</span>
        </div>
        <div class="flex items-center gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor" 
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="text-muted-foreground"
          >
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span class="text-muted-foreground">${
            processedArticle.read_time
          } min read</span>
        </div>
      </div>
      <div class="flex items-center gap-2 text-sm">
        ${
          processedArticle.tags
            ? `
          <div class="flex gap-2 flex-wrap">
            ${processedArticle.tags
              .split(",")
              .map((tag) => `<span class="tag-pill">${tag.trim()}</span>`)
              .join("")}
          </div>
        `
            : ""
        }
      </div>
    `;
  return preview;
}

function updateStatus(message, type = "success") {
  const container = document.querySelector(".status-container");
  const statusElement = document.getElementById("status");

  statusElement.textContent = message;
  container.setAttribute("data-status", type);

  // Show the container if it was hidden
  container.style.display = message ? "block" : "none";
}

document.addEventListener("DOMContentLoaded", async () => {
  initializeTheme();

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
        console.log(error);
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

      updateStatus("Summary complete!", "success");

      refreshArticleList();
    } catch (error) {
      updateStatus("Failed to summarize article", "error");
    } finally {
      // Reset button state
      summarizeButton.disabled = false;
      summarizeButton.textContent = "Summarize Article";
    }
  });
});

// Theme Management
const themeButtons = {
  light: document.getElementById("themeLightButton"),
  dark: document.getElementById("themeDarkButton"),
  system: document.getElementById("themeSystemButton"),
};

// Apply theme and update button states
function applyTheme(theme) {
  // Remove active state from all buttons
  Object.values(themeButtons).forEach((button) => {
    button.setAttribute("data-active", "false");
  });

  // Set active state for current theme button
  themeButtons[theme].setAttribute("data-active", "true");

  if (theme === "system") {
    // Check system preference
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
      .matches
      ? "dark"
      : "light";
    document.documentElement.classList.toggle("dark", systemTheme === "dark");
  } else {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }

  // Save theme preference
  localStorage.setItem("theme-preference", theme);
}

// Initialize theme
function initializeTheme() {
  const savedTheme = localStorage.getItem("theme-preference") || "system";
  applyTheme(savedTheme);
}

// Add click handlers for theme buttons
Object.entries(themeButtons).forEach(([theme, button]) => {
  button.addEventListener("click", () => applyTheme(theme));
});

// Listen for system theme changes
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    const currentTheme = localStorage.getItem("theme-preference");
    if (currentTheme === "system") {
      applyTheme("system");
    }
  });
