const config = require("../config");

/**
 * Authentication middleware to validate API key
 */
function authenticateApiKey(req, res, next) {
  const providedKey = req.headers.authorization;

  if (!providedKey) {
    return res.status(401).json({
      error: "Missing Authorization header",
    });
  }

  if (providedKey !== config.apiKey) {
    return res.status(401).json({
      error: "Invalid API key",
    });
  }

  next();
}

module.exports = { authenticateApiKey };
