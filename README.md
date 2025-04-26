# Twilio Voice <-> Next-AGI Chatbot Backend (Asynchronous)

This Node.js application enables a voice-based conversation with a Next-AGI chatbot using Twilio Voice. It's designed to handle potentially long-running API calls (like those to AI services) without timing out Twilio's webhooks by responding immediately and updating the call asynchronously.

## How it Works (Asynchronous Flow)

1.  **Incoming Call:** A user calls your configured Twilio phone number.
2.  **Twilio Webhook (`/twilio-voice`):** Twilio sends an HTTP POST request to the `/twilio-voice` webhook endpoint on your server.
3.  **Initial Server Response (`/twilio-voice`):**
    *   The server *immediately* responds with TwiML containing:
        *   `<Say>`: To greet the caller (e.g., "Welcome... How can I help?").
        *   `<Gather>`: To listen for the user's speech input. The `action` attribute of `<Gather>` points to the `/gather` endpoint.
    *   This quick response satisfies Twilio's initial webhook request.
4.  **User Speaks & Gather Action (`/gather`):**
    *   Twilio transcribes the user's speech and sends the text (`SpeechResult`) and Call SID (`CallSid`) via HTTP POST to the `/gather` endpoint.
5.  **Immediate Acknowledgment (`/gather`):**
    *   The server receives the `/gather` request. To prevent the 15-second timeout (Twilio Error 11200), it *immediately* responds with TwiML:
        *   `<Say>`: To acknowledge receipt (e.g., "Okay, let me process that.").
        *   `<Pause>`: To keep the call active while the background task runs (adjust length as needed).
        *   A fallback `<Say>` and `<Redirect>` in case the background task fails to update the call.
6.  **Asynchronous API Call (`/gather` background task):**
    *   *After* sending the acknowledgment TwiML, the server starts a background task (`setImmediate`).
    *   This task retrieves the `SpeechResult` and `CallSid`.
    *   It looks up or creates a `conversation_id` for the caller.
    *   It calls the external Next-AGI `/chat-messages` API with the transcribed text.
    *   It aggregates the streaming response from Next-AGI into a complete answer.
7.  **Generate Response TwiML (background task):**
    *   Once the Next-AGI response is ready, the background task generates *new* TwiML containing:
        *   `<Say>`: To speak the chatbot's actual answer.
        *   `<Gather>`: To listen for the user's *next* spoken input, setting the `action` back to `/gather` to continue the loop.
        *   A fallback `<Say>`/`<Redirect>` if the gather times out.
8.  **Update Live Call (background task):**
    *   The background task uses the Twilio REST API client (`client.calls(callSid).update(...)`) to inject this new TwiML into the *live, ongoing* call. This replaces the `<Pause>` from step 5.
9.  **Conversation Loop:** The user hears the response, speaks again, and the process repeats from step 4.

## Features

*   Handles incoming Twilio voice calls asynchronously to prevent webhook timeouts (Error 11200).
*   Uses Twilio `<Gather>` for speech-to-text transcription.
*   Uses Twilio `<Say>` for text-to-speech synthesis.
*   Responds immediately to webhooks and updates the live call via the REST API.
*   Selects the appropriate Next-AGI API key based on configuration.
*   Calls the Next-AGI `chat-messages` endpoint with transcribed queries.
*   Maintains conversation state (`conversation_id`) per caller (in-memory - **not suitable for production**).
*   Includes basic error handling and logging.

## Prerequisites

*   Node.js (v16 or later recommended)
*   npm (Node Package Manager)
*   A Twilio account with a phone number configured for Voice capabilities.
*   Your Twilio Account SID and Auth Token (found in your Twilio Console).
*   Next-AGI API keys.
*   A publicly accessible URL for your server (using [ngrok](https://ngrok.com/) for local testing, or hosted on a cloud provider like AWS, Heroku, Google Cloud, etc.).

## Setup

1.  **Clone or Download:** Get the project files onto your machine.
2.  **Navigate:** Open your terminal and `cd` into the project directory.
3.  **Install Dependencies:** Run `npm install`.
4.  **Create `.env` File:** Create a file named `.env` in the project root. Copy and paste the following, then fill in your actual credentials:
    ```env
    # Twilio Credentials (from Twilio Console)
    TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    TWILIO_AUTH_TOKEN=your_auth_token
    TWILIO_PHONE_NUMBER=+1xxxxxxxxxx # Your Twilio Phone Number

    # Next-AGI API Configuration
    NEXT_AGI_API_BASE_URL=https://api.next-agi.com/v1
    NEXT_AGI_API_KEY_HRMS=app-xxxxxxxxxxxxxxxxxxxxxxxxx # Optional: Key for HRMS assistant
    NEXT_AGI_API_KEY_HOSPITALITY=app-xxxxxxxxxxxxxxxxxxxxxxxxx # Optional: Key for Hospitality assistant
    NEXT_AGI_API_KEY_DEFAULT=app-xxxxxxxxxxxxxxxxxxxxxxxxx # Your default Next-AGI key

    # Server and Chatbot Config
    DEFAULT_ASSISTANT_NAME="Xpectrum Assistant" # Name used in greetings/API selection
    PORT=8000 # Port the local server will run on
    ```
5.  **Verify `.env**:** Double-check that all placeholders are replaced with your real SID, Token, Phone Number, and API keys. Ensure `PORT=8000` matches your intended setup.

## Running the Server

*   **Development (auto-restarts on changes):**
    ```bash
    npm run dev
    ```
*   **Production:**
    ```bash
    npm start
    ```
The server will start listening on the specified port (`8000`). Look for the startup messages in the console.

## Exposing Your Local Server (ngrok for Testing)

Twilio needs to reach your server over the internet.

1.  **Install ngrok:** [ngrok.com](https://ngrok.com/)
2.  **Run ngrok:** Tell it to forward to your server's port (`8000`):
    ```bash
    ngrok http 8000
    ```
3.  **Copy HTTPS URL:** ngrok will display Forwarding URLs. Copy the **HTTPS** one (e.g., `https://random-chars.ngrok-free.app`).

## Configuring Twilio Voice Webhook

1.  Log in to your [Twilio Console](https://www.twilio.com/console).
2.  Go to Phone Numbers > Manage > Active Numbers.
3.  Click your Twilio phone number.
4.  Scroll to **"Voice & Fax"**.
5.  Under **"CONFIGURE WITH"**, ensure "Webhooks, TwiML Bins..." is selected.
6.  For **"A CALL COMES IN"**:
    *   Select **"Webhook"**.
    *   Paste your **ngrok HTTPS URL** followed by `/twilio-voice`. Example: `https://random-chars.ngrok-free.app/twilio-voice` (If hosting elsewhere, use that public URL: `http://<your-ip-or-domain>:8000/twilio-voice`).
    *   Select **`HTTP POST`**.
7.  Click **"Save"**.

## Testing

Call your Twilio number.

*   You should hear: "Welcome..."
*   Speak your query (e.g., "Hello").
*   You should hear: "Okay, let me process that." followed by a pause.
*   After the pause, you should hear the actual response from the Next-AGI bot.
*   The bot should prompt for your next input.

## Troubleshooting Common Errors

*   **"We are sorry, an application error has occurred." (Spoken by Twilio):**
    *   **Meaning:** Twilio failed to get valid TwiML instructions from your server when it needed them (either for the initial `/twilio-voice` or the subsequent `/gather` request, or maybe even during the `client.calls.update`).
    *   **Check:**
        1.  **Your Node.js Server Console:** Look *immediately* after the call fails. Are there ANY errors printed (crashes, exceptions, API errors)? **This is the most important step.**
        2.  **Twilio Call Logs:** (Monitor -> Logs -> Calls -> Click the failed Call SID). Look at the Request Inspector. Did requests to `/twilio-voice` or `/gather` result in HTTP 5xx errors? Was there a specific Twilio error code (like 11200, 12100)?

*   **HTTP 502 Bad Gateway / Error 11200 in Twilio Debugger:**
    *   **Meaning:** Twilio tried to reach your webhook URL (via ngrok if testing locally), but ngrok couldn't get a valid response from your local server.
    *   **Check:**
        1.  **Is your local Node.js server running?** (`node server.js` or `npm run dev`). Check the console output.
        2.  **Did you start ngrok correctly?** (`ngrok http 8000`).
        3.  **Check the ngrok dashboard** (`http://127.0.0.1:4040`) while making a call. Does it show the request coming in? What HTTP status code does it show for the response *from your local server*? (Often 502 if the local server didn't respond).
        4.  **Check server console logs** for crashes or errors happening exactly when the webhook request should be processed.

*   **Call Drops Abruptly (Silence then Hangup):**
    *   **Meaning:** Often caused by the 11200 timeout *before* the asynchronous fix was implemented. With the async fix, it could still happen if:
        *   The background task fails and doesn't update the call.
        *   The `<Pause>` in the initial response is too short for the background task.
        *   An error occurs during `client.calls.update`.
    *   **Check:** Server logs for errors in the `setImmediate` block or during the call update. Increase the `<Pause length="...">` value if API calls are taking longer than expected.

## Limitations & Potential Extensions

*   **In-Memory Conversation Store:** Conversation history (`conversation_id`) is lost when the server restarts. Use a database (Redis, etc.) for persistence in production.
*   **Basic Error Handling:** The `catch` blocks provide basic error reporting. More sophisticated handling (e.g., specific error messages, retries) could be added.
*   **API Latency:** While the async pattern helps, extremely long API calls could still lead to a poor user experience (long pauses). Consider adding features like periodic "Still working..." messages using call updates.
*   **No SMS/Messaging:** This code is voice-only. To add SMS, you'd need to implement a separate route handler (e.g., `/twilio-sms`) using `MessagingResponse`. 