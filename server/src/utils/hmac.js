'use strict';

const crypto = require('crypto');

/**
 * Generate an HMAC-SHA256 signature for a payload.
 */
function generateSignature(payload, secret, timestamp) {
  const message = `${timestamp}.${typeof payload === 'string' ? payload : JSON.stringify(payload)}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Verify an HMAC-SHA256 signature.
 * Rejects if timestamp is older than toleranceMs (default 5 minutes).
 */
function verifySignature(payload, secret, signature, timestamp, toleranceMs = 300000) {
  const now = Date.now();
  const ts = parseInt(timestamp, 10);

  if (isNaN(ts) || Math.abs(now - ts) > toleranceMs) {
    return false;
  }

  const expected = generateSignature(payload, secret, timestamp);

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

module.exports = { generateSignature, verifySignature };
