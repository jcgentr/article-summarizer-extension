// Listen for installation/update of extension
chrome.runtime.onInstalled.addListener(() => {
  // Initialize storage with null tokens
  chrome.storage.local.set({
    supabaseAccessToken: null,
    supabaseRefreshToken: null,
  });
});

// Listen for messages from your web app
chrome.runtime.onMessageExternal.addListener(async function (
  request,
  sender,
  sendResponse
) {
  console.log("Received message:", request);
  console.log("From sender:", sender);

  if (request.type === "LOGIN_SUCCESS" && request.access_token) {
    // Store both tokens
    await chrome.storage.local.set({
      supabaseAccessToken: request.access_token,
      supabaseRefreshToken: request.refresh_token,
    });

    try {
      // Notify all extension views (like popup) that login succeeded
      await chrome.runtime.sendMessage({
        type: "LOGIN_SUCCESS",
        access_token: request.access_token,
        refresh_token: request.refresh_token,
      });
    } catch (error) {
      console.log("Error sending message:", error);
      // Continue execution even if message fails
    }

    sendResponse({ status: "success" });
    return true;
  }
});
