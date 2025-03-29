import { selectors } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import {startCacheServer} from "./cacheServer";

const __dirname = path.dirname(new URL(import.meta.url).pathname);


export interface AILocatorOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  selectorPrefix?: string;
  cacheServerPort?: number;
  selectorFilePath: string;
}

export async function registerAISelector(
  options: AILocatorOptions
): Promise<void> {
  const {
    apiKey,
    baseUrl,
    model,
    selectorPrefix = 'ai',
    cacheServerPort = 3000,
    selectorFilePath,
  } = options;
  // Read the selector.js file from the root assets directory

  const url = `${baseUrl}/chat/completions`;

  options.cacheServerPort = await startCacheServer({
    port: cacheServerPort,
    LLM_API_KEY: apiKey,
    LLM_MODEL: model,
    LLM_API_URL: url,
    selectorFilePath
  });

  const selectorJsPath = path.join(__dirname, './selector.js');
  // const compiledSelectorJsPath = path.join(__dirname, '../assets/compiled_selector.js');

  // Use compiled file if it exists (in published package), otherwise use symlink (in development)
  // const finalSelectorJsPath = fs.existsSync(compiledSelectorJsPath)
  //   ? compiledSelectorJsPath
  //   : selectorJsPath;
  let jsContent = fs.readFileSync(selectorJsPath, 'utf-8');

  {
    jsContent = jsContent.replace("export default ", "");
    const lastSemicolonIndex = jsContent.lastIndexOf(';');
    jsContent = jsContent.substring(0, lastSemicolonIndex);
  }

  // Replace the configuration in the JS content
  // jsContent = jsContent.replace(
  //   /LLM_API_URL:\s*['"].*['"]/,
  //   `LLM_API_URL: "${url}"`
  // );
  // jsContent = jsContent.replace(
  //   /LLM_MODEL:\s*['"].*['"]/,
  //   `LLM_MODEL: "${model}"`
  // );
  // jsContent = jsContent.replace(
  //   /LLM_API_KEY:\s*['"].*['"]/,
  //   `LLM_API_KEY: "${apiKey}"`
  // );
  jsContent = jsContent.replace(
    /CACHE_SERVER_PORT:\s*['"].*['"]/,
    `CACHE_SERVER_PORT: ${options.cacheServerPort}`
  );


  // Register the selector with Playwright
  await selectors.register(selectorPrefix, {
    content: jsContent
  });
}
