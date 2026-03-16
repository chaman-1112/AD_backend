import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export default defineConfig({
  testDir: './tests',
  
  timeout: 30000000,
  
  // Expect timeout for assertions
  expect: {
    timeout: 10000
  },
  
  // Run tests sequentially to avoid conflicts
  fullyParallel: false,
  
  // Retry failed tests once
  retries: 1,
  
  // Number of workers (1 for sequential execution)
  workers: 1,
  
  reporter: 'html',
  
  use: {
    ignoreHTTPSErrors: true,

    // HTTP Basic Auth credentials for staging
    httpCredentials: {
      username: process.env.STAGE_HTTP_USERNAME || '',
      password: process.env.STAGE_HTTP_PASSWORD || '',
    },
    
    // // Reduced action timeout for faster failures
    // actionTimeout: 10000,
    
    // // Navigation timeout
    // navigationTimeout: 3000000,
    
    // Keep browser visible
    headless: false,
    
    // Set viewport to null to allow maximized window
    viewport: null,
    
      
    // Collect trace on failure
    trace: 'on-first-retry',
    
    // Screenshot on failure
    screenshot: 'only-on-failure',
    
    // Video on failure
    video: 'retain-on-failure',
    
    launchOptions: {
      // Start browser maximized
      args: ['--start-maximized'],
      // Use existing user profile - replace with your actual profile path
      // For Chrome: 'C:\\Users\\YourUsername\\AppData\\Local\\Google\\Chrome\\User Data'
      // For Edge: 'C:\\Users\\YourUsername\\AppData\\Local\\Microsoft\\Edge\\User Data'
      executablePath: undefined, // Let Playwright use default browser
      // Uncomment and modify the line below with your actual profile path
      // userDataDir: 'C:\\Users\\YourUsername\\AppData\\Local\\Google\\Chrome\\User Data',
    }
  },

  projects: [
    {
      name: 'Microsoft Edge',
      use: { 
        channel: 'msedge',
        viewport: null, // Ensure maximized window
        launchOptions: {
          args: ['--start-maximized'],
          userDataDir: 'C:\\Users\\ajbha\\AppData\\Local\\Microsoft\\Edge\\User Data',
        }
      },
    }
    // {
    //   name: 'Google Chrome',
    //   use: { 
    //     channel: 'chrome',
    //     viewport: null,
    //     launchOptions: {
    //       args: ['--start-maximized'],
    //       userDataDir: 'C:\\Users\\ajbha\\AppData\\Local\\Google\\Chrome\\User Data',
    //     }
    //   },
    // },
  ],
});