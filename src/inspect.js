import { loadConfig } from './config.js';
import { WordPressClient } from './wpClient.js';

function printResult(label, result) {
  console.log(`${label}: ${result}`);
}

function printAuthHint(error, config) {
  if (error.status !== 401) {
    return;
  }

  console.log('');
  console.log('Authentication required.');

  if (!config.hasWordPressAuth) {
    console.log('Add WORDPRESS_USERNAME and WORDPRESS_APP_PASSWORD to your .env file.');
  } else {
    console.log('The configured WordPress username or application password was rejected.');
  }
}

async function checkStep(label, action, config) {
  try {
    const result = await action();
    const count = Array.isArray(result) ? result.length : 'ok';
    printResult(label, count);
    return true;
  } catch (error) {
    printResult(label, `failed (${error.status || 'unknown'} ${error.statusText || ''})`);
    printAuthHint(error, config);
    return false;
  }
}

async function main() {
  const config = loadConfig();
  const client = new WordPressClient({
    baseUrl: config.wordpressBaseUrl,
    username: config.wordpressUsername,
    appPassword: config.wordpressAppPassword
  });

  console.log('');
  console.log('WordPress API inspection');
  console.log('');
  printResult('Base URL', config.wordpressBaseUrl);
  printResult('Authentication configured', config.hasWordPressAuth ? 'yes' : 'no');
  console.log('');

  await checkStep('REST root /wp-json/', () => client.fetchRoot(), config);
  await checkStep('Posts endpoint', () => client.fetchPosts({ limit: config.limitPosts }), config);
  await checkStep('Pages endpoint', () => client.fetchPages({ limit: 5 }), config);
  await checkStep('Categories endpoint', () => client.fetchCategories({ limit: 100 }), config);
  await checkStep('Tags endpoint', () => client.fetchTags({ limit: 100 }), config);
  await checkStep('Media endpoint', () => client.fetchMedia({ limit: 100 }), config);

  console.log('');
  console.log('Inspection complete');
}

main().catch((error) => {
  console.error('');
  console.error('Inspection failed');
  console.error(error.message);
  process.exitCode = 1;
});
