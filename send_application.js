const { chromium } = require('playwright');
const readline = require('readline');
const fs = require('fs');
const { answersDatabase, saveAnswer, handleNewQuestion, calculateSimilarity, getMostSimilarQuestion, normalizeAndTokenize } = require('./utils_Numeric.js');
const { answerDropDown, handleNewAnswerDropDown } = require('./utils_DropDown');
const { answerBinaryQuestions, handleNewQuestionBinary} = require('./utils_Binary.js');

//------------------------------------------------1.Numeric response HANDLER-------------------------

async function answerNumericQuestions(page) {
  const questionElements = await page.$$('label.artdeco-text-input--label');
  for (let questionElement of questionElements) {
    const questionText = await questionElement.textContent();
    console.log("Question", questionText);
    const inputId = await questionElement.getAttribute('for');
    const answerElement = await page.$(`#${inputId}`);

    const result = getMostSimilarQuestion(questionText.trim());
    let mostSimilarQuestion = null;
    let maxSimilarity = 0;

    if (result) {
      mostSimilarQuestion = result.mostSimilarQuestion;
      maxSimilarity = result.maxSimilarity;
    }

    let answer = null;
    if (mostSimilarQuestion && maxSimilarity > 0.7) {
      answer = answersDatabase[mostSimilarQuestion];
    } else {
      answer = await handleNewQuestion(questionText.trim());
    }

    if (answerElement && answer !== null) {
      await answerElement.fill(answer);
    } else {
      console.log(`No answer found or no suitable question found for: "${questionText.trim()}".`);
    }
  }
}

// -------------------RESPONSE HANDLER---------------

async function answerQuestions(page){
  await  answerNumericQuestions(page)
  await  answerBinaryQuestions(page)
  await answerDropDown(page)
}



async function handleNextOrReview(page) {
  let hasNextButton = true;

  while (hasNextButton) {
    try {
      const nextButton = await page.$('button[aria-label="Continue to next step"]');
      if (nextButton) {
        await nextButton.click();
        await page.waitForTimeout(3000);
        await answerQuestions(page);
      } else {
        hasNextButton = false;
      }
    } catch (error) {
      hasNextButton = false;
    }
  }

  try {
    const reviewButton = await page.$('button[aria-label="Review your application"]');
    if (reviewButton) {
      await reviewButton.click();
      console.log("Review button successfully clicked");

      const submitButton = await page.$('button[aria-label="Submit application"]');
      if (submitButton) {
        await submitButton.click();
        console.log("Submit button clicked");

        await page.waitForTimeout(5000);
        await page.waitForSelector('button[aria-label="Dismiss"]', { visible: true });
        let modalButton = await page.$('button[aria-label="Dismiss"]');
        let attempts = 0;
        const maxAttempts = 10;

        while (attempts < maxAttempts) {
          try {
            await modalButton.evaluate(b => b.click());
            console.log("Dismiss button clicked");
            break;
          } catch (error) {
            console.log(`Attempt ${attempts + 1} failed: ${error.message}`);
            attempts++;
            await page.waitForTimeout(500);
            modalButton = await page.$('button[aria-label="Dismiss"]');
          }
        }

        if (attempts === maxAttempts) {
          console.log("Failed to click the Dismiss button after multiple attempts.");
        }
      }
    }
  } catch (error) {
    console.log('Review button not found or failed to click:', error.message);
  }
}



//--------- Main assist Funtions--------------
async function fillPhoneNumber(page, phoneNumber) {
  try {
    let inputElement;

    try {
      let labelName = "Mobile phone number";
      inputElement = await page.getByLabel(labelName, { exact: true });
      await inputElement.fill(phoneNumber);
      console.log(`Filled ${labelName} with ${phoneNumber}`);
      return;
    } catch (error) {
      console.log("Mobile phone number input field not found, trying Phone label.");
    }

    try {
      let labelName = "Phone";
      inputElement = await page.getByLabel(labelName, { exact: true });
      await inputElement.fill(phoneNumber);
      console.log(`Filled ${labelName} with ${phoneNumber}`);
    } catch (error) {
      console.log("Phone input field not found.");
    }

  } catch (error) {
    console.error("Error filling phone number:", error);
  }
}

async function getJobName(page) {
  try {
    const jobNameElement = await page.$('//h1[contains(@class,"t-24 t-bold")]//a[1]');
    if (jobNameElement) {
      const jobName = await jobNameElement.textContent();
      return jobName.trim();
    } else {
      return "Unknown Job";
    }
  } catch (error) {
    console.error("Error extracting job name:", error);
    return "Unknown Job";
  }
}

// Helper function to wait for manual login
async function waitForManualLogin(page) {
  console.log('='.repeat(60));
  console.log('PLEASE LOG IN TO LINKEDIN MANUALLY IN THE BROWSER WINDOW');
  console.log('='.repeat(60));
  console.log('The script will automatically continue once you are logged in...');
  console.log('Waiting for login to complete...\n');
  
  try {
    await Promise.race([
      page.waitForSelector('a.global-nav__primary-link--active', { timeout: 0 }),
      page.waitForSelector('div.feed-shared-update-v2', { timeout: 0 }),
      page.waitForURL('**/feed/**', { timeout: 0 }),
      page.waitForURL('**/jobs/**', { timeout: 0 })
    ]);
    
    console.log('\n' + '='.repeat(60));
    console.log('LOGIN SUCCESSFUL! Starting job application process...');
    console.log('='.repeat(60) + '\n');
    
    return true;
  } catch (error) {
    console.log('Login detection failed:', error.message);
    return false;
  }
}

// Helper function to search for jobs
async function performJobSearch(page, jobTitle) {
  console.log(`Searching for: ${jobTitle}`);
  
  // Try multiple approaches to find and use the search box
  const searchStrategies = [
    // Strategy 1: Direct search with jobs/search URL
    async () => {
      console.log('Strategy 1: Using direct search URL...');
      const encodedJob = encodeURIComponent(jobTitle);
      await page.goto(`https://www.linkedin.com/jobs/search/?keywords=${encodedJob}&f_AL=true`, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      await page.waitForTimeout(5000);
      return true;
    },
    
    // Strategy 2: Use the search input field
    async () => {
      console.log('Strategy 2: Looking for search input field...');
      const searchInput = await page.$('input.jobs-search-box__text-input');
      if (searchInput) {
        await searchInput.click();
        await page.waitForTimeout(1000);
        await searchInput.fill(jobTitle);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(5000);
        return true;
      }
      return false;
    },
    
    // Strategy 3: Use any visible search box
    async () => {
      console.log('Strategy 3: Looking for any search box...');
      const allInputs = await page.$$('input[type="text"]');
      for (let input of allInputs) {
        const placeholder = await input.getAttribute('placeholder');
        const ariaLabel = await input.getAttribute('aria-label');
        
        if ((placeholder && placeholder.toLowerCase().includes('search')) || 
            (ariaLabel && ariaLabel.toLowerCase().includes('search'))) {
          await input.click();
          await page.waitForTimeout(1000);
          await input.fill(jobTitle);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(5000);
          return true;
        }
      }
      return false;
    }
  ];
  
  // Try each strategy until one succeeds
  for (let i = 0; i < searchStrategies.length; i++) {
    try {
      const success = await searchStrategies[i]();
      if (success) {
        console.log(`✓ Search successful using strategy ${i + 1}`);
        return true;
      }
    } catch (error) {
      console.log(`Strategy ${i + 1} failed: ${error.message}`);
    }
  }
  
  console.log('All search strategies failed');
  return false;
}

// Helper function to apply Easy Apply filter
async function applyEasyApplyFilter(page) {
  console.log('Applying Easy Apply filter...');
  
  const filterStrategies = [
    // Strategy 1: Direct button with aria-label
    async () => {
      const button = await page.$("button[aria-label*='Easy Apply']");
      if (button) {
        await button.click();
        await page.waitForTimeout(2000);
        return true;
      }
      return false;
    },
    
    // Strategy 2: Look for filter button by text
    async () => {
      const buttons = await page.$$('button');
      for (let button of buttons) {
        const text = await button.textContent();
        if (text && text.includes('Easy Apply')) {
          await button.click();
          await page.waitForTimeout(2000);
          return true;
        }
      }
      return false;
    },
    
    // Strategy 3: Already in URL (f_AL=true means Easy Apply filter is on)
    async () => {
      const url = page.url();
      if (url.includes('f_AL=true')) {
        console.log('Easy Apply filter already in URL');
        return true;
      }
      return false;
    }
  ];
  
  for (let i = 0; i < filterStrategies.length; i++) {
    try {
      const success = await filterStrategies[i]();
      if (success) {
        console.log(`✓ Easy Apply filter applied using strategy ${i + 1}`);
        return true;
      }
    } catch (error) {
      console.log(`Filter strategy ${i + 1} failed: ${error.message}`);
    }
  }
  
  console.log('Could not apply Easy Apply filter');
  return false;
}


//###########################-----------MAIN FUNCTION----------###############################
(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--start-maximized']
  });
 
  const context = await browser.newContext({
    viewport: null
  });
  
  const page = await context.newPage();
  
  try {
    // Navigate to LinkedIn login page
    await page.goto('https://www.linkedin.com/login', { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    //-----------------------------------1. MANUAL LOGIN-----------------------------------------------
    
    const loginSuccess = await waitForManualLogin(page);
    
    if (!loginSuccess) {
      console.log('Failed to detect successful login. Exiting...');
      await browser.close();
      return;
    }
    
    await page.waitForTimeout(3000);
    
    //---------------------------2. GO TO JOB SEARCH-----------------------------------------------
    
    console.log('Navigating to LinkedIn Jobs page...');
    
    // Navigate to jobs page and wait for it to fully load
    await page.goto('https://www.linkedin.com/jobs/', { 
      waitUntil: 'networkidle',
      timeout: 60000 
    });
    
    console.log('Jobs page loaded. Current URL:', page.url());
    await page.waitForTimeout(5000);
    
    // Perform job search
    const searchSuccess = await performJobSearch(page, 'Data Engineer');
    
    if (!searchSuccess) {
      console.log('MANUAL INTERVENTION REQUIRED:');
      console.log('Please manually search for "Data Engineer" in the browser');
      console.log('Waiting 30 seconds for you to complete the search...');
      await page.waitForTimeout(30000);
    }
    
    // Apply Easy Apply filter
    await applyEasyApplyFilter(page);
    
    console.log('Current URL after search:', page.url());
    await page.waitForTimeout(3000);
    
    //------------------------------------3. START APPLYING JOBS-----------------------------------------------
    
    let currentPage = 1;
    let jobCounter = 0;

    while (true) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Processing page ${currentPage}`);
      console.log('='.repeat(60));

      // Try multiple selectors for job listings
      let jobListings = await page.$$('div.job-card-container');
      
      if (jobListings.length === 0) {
        jobListings = await page.$$('div.jobs-search-results__list-item');
      }
      
      if (jobListings.length === 0) {
        jobListings = await page.$$('li.jobs-search-results__list-item');
      }
      
      console.log(`Number of jobs listed on page ${currentPage}: ${jobListings.length}`);

      if (jobListings.length === 0) {
        console.log(`No jobs found on page ${currentPage}.`);
        console.log('Please check if you are on the correct jobs search page.');
        console.log('Waiting 10 seconds before retrying...');
        await page.waitForTimeout(10000);
        
        // Retry once
        jobListings = await page.$$('div.job-card-container, div.jobs-search-results__list-item, li.jobs-search-results__list-item');
        
        if (jobListings.length === 0) {
          console.log('Still no jobs found. Exiting.');
          break;
        }
      }

      // Start applying jobs on current page
      for (let i = 0; i < jobListings.length; i++) {
        try {
          // Re-fetch job listings to avoid stale elements
          let currentJobListings = await page.$$('div.job-card-container');
          if (currentJobListings.length === 0) {
            currentJobListings = await page.$$('div.jobs-search-results__list-item, li.jobs-search-results__list-item');
          }
          
          if (i >= currentJobListings.length) break;
          
          const job = currentJobListings[i];
          
          jobCounter++;
          console.log(`\n--- Processing job ${jobCounter} on page ${currentPage} ---`);
          
          await job.click();
          await page.waitForTimeout(2000);
          
          //----------------------------------CASE 1: ALREADY APPLIED----------------
          
          const alreadyApplied = await page.$('span.artdeco-inline-feedback__message:has-text("Applied")');
          if (alreadyApplied) { 
            const jobName = await getJobName(page);
            console.log(`Already applied to: ${jobName}. Skipping.`);
            continue;
          }
          
          //----------------------------------CASE 2: NOT EASY APPLY---------------
          
          let easyApplyButton;

          try {
            easyApplyButton = await page.waitForSelector('button.jobs-apply-button', { timeout: 5000 });
            await easyApplyButton.click();
            await page.waitForTimeout(2000);
          } catch (error) {
            console.log('No Easy Apply button found. Skipping this job.');
            continue;
          }

          //----------------------------------CASE 3: APPLYING NOW ------------------
          
          const jobName = await getJobName(page);
          console.log(`Applying to: ${jobName}`);
          
          await page.waitForTimeout(3000);

          // -------------- Fill the Static Data ------------------- 
       
          try {
            const emailLabel = await page.$('label:has-text("Email address")') || await page.$('label:has-text("Email")');
            if (emailLabel) {
              const emailInputId = await emailLabel.getAttribute('for');
              await page.selectOption(`#${emailInputId}`, 'kanishbm15@gmail.com');
            }
          } catch (error) {
            console.log('Email selection not needed or failed');
          }

          try {
            const phoneCountryLabel = await page.$('label:has-text("Phone country code")');
            if (phoneCountryLabel) {
              const phoneCountryInputId = await phoneCountryLabel.getAttribute('for');
              await page.selectOption(`#${phoneCountryInputId}`, 'India (+91)');
            }
          } catch (error) {
            console.log('Phone country code not needed');
          }

          await fillPhoneNumber(page, '7845321555');

          await page.waitForTimeout(2000);

          await answerQuestions(page);
          await handleNextOrReview(page);
          
          console.log(`✓ Successfully processed job: ${jobName}`);
          
        } catch (error) {
          console.log(`Error processing job ${jobCounter}:`, error.message);
          continue;
        }
      }
      
      // Move to the next page if available
      currentPage++;
      const nextPageButton = await page.$(`button[aria-label="Page ${currentPage}"]`);
      
      if (nextPageButton) {
        await nextPageButton.click();
        await page.waitForTimeout(5000);
        console.log(`Navigated to page ${currentPage}`);
      } else {
        console.log(`No more pages found. Exiting.`);
        break;
      }
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Job application process completed!`);
    console.log(`Total jobs processed: ${jobCounter}`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error("Script error:", error);
  } finally {
    console.log('\nClosing browser in 5 seconds...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();