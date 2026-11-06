// =============================================================================
// FILE: scripts/generate_oauth_token.js
// PURPOSE: Generates a Google Drive OAuth 2.0 Refresh Token for personal @gmail.com
//          accounts to enable unlimited uploads using personal 15GB Drive quota.
//
// USAGE:
//   node scripts/generate_oauth_token.js <CLIENT_ID> <CLIENT_SECRET>
// =============================================================================

import { google } from 'googleapis';
import readline from 'readline';
import fs from 'fs';

const clientId = process.argv[2] || process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.argv[3] || process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.log('\n❌ Missing OAuth Client ID or Client Secret.\n');
  console.log('How to get them (free in Google Cloud Console):');
  console.log('1. Go to: https://console.cloud.google.com/apis/credentials');
  console.log('2. Click "+ CREATE CREDENTIALS" → "OAuth client ID"');
  console.log('3. Application type: "Desktop app" or "Web application"');
  console.log('4. Copy the Client ID and Client Secret.');
  console.log('\nThen run:');
  console.log('  node scripts/generate_oauth_token.js <CLIENT_ID> <CLIENT_SECRET>\n');
  process.exit(1);
}

const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';
const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive'],
});

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║        ROTCIMS — Google Drive OAuth 2.0 Authorizer           ║');
╚══════════════════════════════════════════════════════════════╝\n');
console.log('1. Open this URL in your phone/computer browser:\n');
console.log(authUrl);
console.log('\n2. Sign in with your Google account and tap "Allow".');
console.log('3. Copy the authorization code shown on screen and paste it below:\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Enter authorization code: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    const refreshToken = tokens.refresh_token;

    console.log('\n✅ Authorization successful!');
    console.log(`\nYour Refresh Token is:\n${refreshToken}\n`);

    // Append to .env.local
    let envContent = '';
    try { envContent = fs.readFileSync('.env.local', 'utf8'); } catch {}

    envContent = envContent.replace(/GOOGLE_CLIENT_ID=.*\n?/, '');
    envContent = envContent.replace(/GOOGLE_CLIENT_SECRET=.*\n?/, '');
    envContent = envContent.replace(/GOOGLE_REFRESH_TOKEN=.*\n?/, '');

    envContent += `GOOGLE_CLIENT_ID=${clientId}\n`;
    envContent += `GOOGLE_CLIENT_SECRET=${clientSecret}\n`;
    envContent += `GOOGLE_REFRESH_TOKEN=${refreshToken}\n`;

    fs.writeFileSync('.env.local', envContent);
    console.log('✓ Successfully saved GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN to .env.local!\n');
  } catch (err) {
    console.error('❌ Failed to retrieve tokens:', err.message);
  }
});
