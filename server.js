const express = require('express');
const fetch = require('node-fetch');
const twilio = require('twilio');
const config = require('./config');

const app = express();
// Twilio webhook requests are URL encoded
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const VoiceResponse = twilio.twiml.VoiceResponse;

// --- Simple In-Memory Conversation Store ---
// Stores conversation_id per caller phone number
const conversationStore = {}; // { '+14155238886': 'conv_id_123', ... }

// --- Twilio REST Client (Needed for updating live calls) ---
if (!config.twilioAccountSid || !config.twilioAuthToken) {
    console.error("Twilio credentials (SID and Auth Token) are missing in .env");
    process.exit(1);
}
// Initialize the Twilio client
const client = twilio(config.twilioAccountSid, config.twilioAuthToken);

// --- Health Check Endpoint ---
app.get('/', (req, res) => {
  res.status(200).send('Twilio Voice <-> Next-AGI Chatbot is running!');
});

// --- Twilio Voice Webhook Endpoint (Initial Call) ---
app.post('/twilio-voice', (req, res) => {
  const twiml = new VoiceResponse();
  const fromNumber = req.body.From; // Caller's phone number

  console.log(`Incoming call from ${fromNumber}`);

  // Greet the caller and gather the first input
  twiml.say(`Welcome to the ${config.defaultAssistantName}. How can I help you today?`);

  // Listen for speech input and send result to /gather
  twiml.gather({
    input: 'speech',
    action: '/gather', // Send the result to our /gather handler
    speechTimeout: 'auto', // Automatically determine end of speech
    // language: 'en-US', // Specify language if needed
    // hints: 'account status, open ticket, billing inquiry', // Provide hints for better recognition
  });

  // If the user doesn't say anything after the initial greeting, redirect back to /voice to repeat
  twiml.redirect('/twilio-voice');

  res.type('text/xml');
  res.send(twiml.toString());
});

// --- Twilio Gather Action Endpoint (Processes Speech) ---
// This now responds quickly and processes the API call in the background
app.post('/gather', (req, res) => {
  const fromNumber = req.body.From;
  const speechResult = req.body.SpeechResult;
  const confidence = req.body.Confidence;
  const callSid = req.body.CallSid; // Important: We need the CallSid

  console.log(`Gather from ${fromNumber} (CallSid: ${callSid}): "${speechResult}" (Confidence: ${confidence})`);

  if (speechResult && callSid) {
    // --- Respond Immediately to Twilio to prevent timeout ---
    const initialTwiml = new VoiceResponse();
    initialTwiml.say("Okay, let me process that.");
    // Keep the call alive while we wait for the async task.
    // A long pause works, but redirecting to a waiting endpoint might be cleaner for complex flows.
    // Let's use pause for simplicity here. Adjust length based on expected max API time + buffer.
    initialTwiml.pause({ length: 45 });
    // Fallback if the async task fails to update the call somehow
    initialTwiml.say("Something went wrong while processing. Please try again.");
    initialTwiml.redirect('/twilio-voice');

    res.type('text/xml');
    res.send(initialTwiml.toString());
    // --- End of Immediate Response ---

    // --- Start Asynchronous Processing ---
    // Use setImmediate or process.nextTick to ensure response is sent before heavy work starts
    setImmediate(async () => {
      try {
        console.log(`[${callSid}] Starting async API call for: "${speechResult}"`);
        const userConversationId = conversationStore[fromNumber] || "";
        const assistantName = config.defaultAssistantName;
        const apiKey = config.getApiKey(assistantName);

        if (!apiKey) {
            throw new Error(`[${callSid}] Could not determine API key for assistant: ${assistantName}`);
        }

        const payload = {
          inputs: {},
          query: speechResult,
          response_mode: "streaming",
          conversation_id: userConversationId,
          user: fromNumber,
          files: []
        };

        const apiStartTime = Date.now();
        const response = await fetch(`${config.nextAgiApiBaseUrl}/chat-messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream"
          },
          body: JSON.stringify(payload),
          // Add a timeout to the fetch call itself if needed (using AbortController)
        });
        const apiEndTime = Date.now();
        console.log(`[${callSid}] API call took ${apiEndTime - apiStartTime} ms. Status: ${response.status}`);


        if (!response.ok) {
          let errorBody = 'Unknown API error';
          try { errorBody = await response.text(); } catch (e) {}
          throw new Error(`[${callSid}] API error! Status: ${response.status}. Body: ${errorBody}`);
        }

        // Process Streaming Response
        let fullAnswer = "";
        let latestConversationId = userConversationId;
        const reader = response.body;
        const decoder = new TextDecoder();

        for await (const chunk of reader) {
          const text = decoder.decode(chunk, { stream: true });
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const eventData = JSON.parse(line.slice(6));
                if (eventData.conversation_id) {
                  latestConversationId = eventData.conversation_id;
                }
                if (eventData.answer) {
                  fullAnswer += eventData.answer;
                }
              } catch (parseError) {
                console.error(`[${callSid}] Error parsing SSE event:`, parseError, "Line:", line);
              }
            }
          }
        }

        // Store Updated Conversation ID
        if (latestConversationId && latestConversationId !== userConversationId) {
          console.log(`[${callSid}] Updating conversation ID for ${fromNumber} to ${latestConversationId}`);
          conversationStore[fromNumber] = latestConversationId;
        }

        // --- Prepare TwiML for the Actual Response ---
        const responseTwiml = new VoiceResponse();
        if (fullAnswer.trim()) {
          console.log(`[${callSid}] Speaking response to ${fromNumber}: "${fullAnswer.substring(0, 100)}..."`);
          responseTwiml.say(fullAnswer);
        } else {
          console.log(`[${callSid}] No answer content received from API for ${fromNumber}.`);
          responseTwiml.say("Sorry, I couldn't generate a response for that.");
        }

        // Gather the next input
        responseTwiml.gather({
          input: 'speech',
          action: '/gather',
          speechTimeout: 'auto',
        });
        // Fallback if gather times out after response
        responseTwiml.say("Did you have another question?");
        responseTwiml.redirect('/twilio-voice');

        // --- Update the Live Call with the Response TwiML ---
        console.log(`[${callSid}] Updating live call with final TwiML.`);
        await client.calls(callSid).update({
            twiml: responseTwiml.toString()
        });
        console.log(`[${callSid}] Live call update successful.`);

      } catch (error) {
        console.error(`[${callSid}] Error during async processing or call update:`, error);
        // Try to inform the user on the call if possible, otherwise just log
        try {
            const errorTwiml = new VoiceResponse();
            errorTwiml.say("Sorry, an error occurred while processing your request. Please try again.");
            errorTwiml.pause({ length: 1 }); // Brief pause before potentially redirecting
            errorTwiml.redirect('/twilio-voice'); // Redirect to restart flow

            await client.calls(callSid).update({
                twiml: errorTwiml.toString()
            });
        } catch (updateError) {
            console.error(`[${callSid}] Failed to update call with error message:`, updateError);
            // If updating fails, the call might already be disconnected or in a bad state.
        }
      }
    });
    // --- End Asynchronous Processing ---

  } else if (!speechResult) {
    // No speech detected
    console.log(`[${callSid}] No speech detected for gather from ${fromNumber}.`);
    const noSpeechTwiml = new VoiceResponse();
    noSpeechTwiml.say("Sorry, I didn't catch that. Could you please repeat?");
    noSpeechTwiml.gather({ input: 'speech', action: '/gather', speechTimeout: 'auto' });
    noSpeechTwiml.redirect('/twilio-voice');
    res.type('text/xml');
    res.send(noSpeechTwiml.toString());
  } else {
    // Missing CallSid or other essential data
     console.error(`[${callSid || 'Unknown CallSid'}] Missing CallSid or SpeechResult in /gather request from ${fromNumber}. Body:`, req.body);
     const errorTwiml = new VoiceResponse();
     errorTwiml.say("An internal error occurred. Please hang up and try again.");
     errorTwiml.hangup();
     res.type('text/xml');
     res.send(errorTwiml.toString());
  }
});

// --- Start Server ---
app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
  console.log(`Configure your Twilio number's VOICE webhook to: http://<your-public-url>:${config.port}/twilio-voice (Method: HTTP POST)`);
  console.log("Make sure your Next-AGI API Keys and Twilio credentials are set in .env");
}); 