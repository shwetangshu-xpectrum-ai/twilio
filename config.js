require('dotenv').config();

const apiKeys = {
  HRMS: process.env.NEXT_AGI_API_KEY_HRMS,
  Hospitality: process.env.NEXT_AGI_API_KEY_HOSPITALITY,
  default: process.env.NEXT_AGI_API_KEY_DEFAULT
};

// Helper function to get the correct API key based on assistant name
// Matches the logic from your React component
const getApiKey = (assistantName) => {
  if (assistantName && assistantName.includes('HRMS')) {
    return apiKeys.HRMS;
  }
  if (assistantName && assistantName.includes('Hospitality')) {
    return apiKeys.Hospitality;
  }
  // Add more checks here for other assistant names if needed
  return apiKeys.default;
};

module.exports = {
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
  nextAgiApiBaseUrl: process.env.NEXT_AGI_API_BASE_URL || "https://api.next-agi.com/v1",
  defaultAssistantName: process.env.DEFAULT_ASSISTANT_NAME || "Xpectrum Assistant",
  port: process.env.PORT || 3000,
  getApiKey: getApiKey,
  apiKeys: apiKeys // Export the map if needed elsewhere, ensure keys are loaded
}; 