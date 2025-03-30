import * as path from 'node:path';
import * as fs from 'node:fs';
import http from 'http';
import crypto from 'crypto';

// Add at the top of the file, after the imports
const isDevelopment = process.env.NODE_ENV === 'development';

type SelectorData = {
    [hash: string]: {
        desc: string;
        selector: string;
    };
}

// JSON object to store hashes
const storedData: { [hash: string]: string | null /*{ selector: string; html: string }*/ } = {};

const _failedSuggestions: Map<string, {desc: string; selectors: Set<string>}> = new Map();
const _successfulSuggestions: Map<string, {desc: string; selector: string}> = new Map();
const _invalidSuggestions: Map<string, {desc: string; selectors: Set<string>}> = new Map();

export function startCacheServer({
                                     port = 3000,
                                     LLM_API_URL,
                                     LLM_API_KEY,
                                     LLM_MODEL,
                                     selectorFilePath
                                 }: {
    port?: number,
    LLM_API_URL: string;
    LLM_API_KEY: string;
    LLM_MODEL: string,
    selectorFilePath?: string;
}): Promise<number> {

    let fileStorageMode = false;

    // If a file path is provided, try to initialize file storage
    if (selectorFilePath) {
        fileStorageMode = loadSelectorsFromFile(selectorFilePath);
        if (!fileStorageMode) {
            console.warn(`Unable to use file storage at ${selectorFilePath}, switching to memory-only mode`);
        } else {
            console.log(`Operating in file storage mode with path: ${selectorFilePath}`);
        }
    } else {
        console.log('Operating in memory-only mode (no file path provided)');
    }

    const server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/selector') {
            create(req, res);
        } else if (req.method === 'POST' && req.url === '/failed') {
            // failed(req, res);
            reqResHandler(req, res, _failedProcessor);
        } else if (req.method === 'POST' && req.url === '/invalid') {
            reqResHandler(req, res, _invalidProcessor);
        } else {
            res.writeHead(404, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({error: 'Not found'}));
        }
    });

    return new Promise((resolve) => {
        server.listen(port, () => {
            console.log(`Server is running on http://localhost:${port}`);
            resolve(port);
        });
    });

    function create(req: http.IncomingMessage, res: http.ServerResponse) {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const {selector, html} = JSON.parse(body);

                if (!selector || !html) {
                    res.writeHead(400, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({error: 'Both selector and html fields are required'}));
                    return;
                }

                // Hash the combined string of selector and html
                const hash = crypto.createHash('sha256').update(selector + html).digest('hex');


                // Store the hashed data in the JSON object
                if (storedData[hash]) {
                    res.writeHead(200, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({selector: storedData[hash], hash}));
                    return;
                }

                console.log({description: selector, content: html, hash: hash})

                const newSelector = await getSelectorFromLLM({description: selector, content: html, hash: hash});
                if (!newSelector) {
                    addToInvalidSuggestions(hash, "NULL", selector);
                    res.writeHead(400, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({error: 'No selector generated'}));
                    return;
                }
                storedData[hash] = newSelector;
                _successfulSuggestions.set(hash, {
                    desc: selector,
                    selector: newSelector
                });

                syncToFile();


                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({selector: newSelector, hash}));
            } catch (error) {
                console.error('Error in create:', error);
                res.writeHead(400, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({error: 'Invalid JSON data'}));
            }
        });
    }

    async function _failedProcessor({selector, html, hash}: Parameters<fncProcessor>[0]) : ReturnType<fncProcessor> {

            try {
                if (!selector || !html || !hash) {
                    return {
                        success: false,
                        msg: 'selector, html and hash fields are required'
                    }
                }

                const lastSuccessfulSelector = _successfulSuggestions.get(hash);
                if (lastSuccessfulSelector) {
                    addToFailedSuggestions(hash, lastSuccessfulSelector.selector, selector);
                    _successfulSuggestions.delete(hash);
                }

                if (!isDevelopment) {
                    return {
                        success: false,
                        msg: 'Selector marked as failed'
                    }
                }

                // Retry with new selector in development mode
                const newSelector = await getSelectorFromLLM({description: selector, content: html, hash: hash});
                if (!newSelector) {
                    addToInvalidSuggestions(hash, "NULL", selector);
                    return {
                        success: false,
                        msg: 'No selector generated'
                    }
                    // res.writeHead(200, {'Content-Type': 'application/json'});
                    // res.end(JSON.stringify({message: 'No Selector failed', hash, selector: "NULL"}));
                    // return;
                }

                storedData[hash] = newSelector;
                _successfulSuggestions.set(hash, {
                    desc: selector,
                    selector: newSelector
                });

                syncToFile();

                // res.writeHead(200, {'Content-Type': 'application/json'});
                // res.end(JSON.stringify({selector: newSelector, hash}));
                return {
                    success: true,
                    selector: newSelector,
                    hash
                }
            } catch (error) {
                // res.writeHead(400, {'Content-Type': 'application/json'});
                // res.end(JSON.stringify({error: 'Invalid JSON data'}));
                return {
                    success: false,
                    msg: 'Invalid JSON data'
                }
            }
    }

    type fncProcessor = (args: { selector: string, html: string, hash: string }) => Promise<
        | { success: false; msg: string; }
        | { success: true; selector: string; hash: string; } >

// Implement the invalid function
    function reqResHandler(req: http.IncomingMessage, res: http.ServerResponse, processor: fncProcessor) {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            const {selector, html, hash} = JSON.parse(body);
            const r = await processor({selector, html, hash});
            syncToFile();
            res.writeHead(r.success ? 200 : 400, {'Content-Type': 'application/json'});
            res.end(JSON.stringify(r));
        });
    }

    async function _invalidProcessor({selector, html, hash}: Parameters<fncProcessor>[0]) : ReturnType<fncProcessor> {
        try {

            if (!selector || !html || !hash) {
                // res.writeHead(400, {'Content-Type': 'application/json'});
                // res.end(JSON.stringify({error: 'selector, html and hash fields are required'}));
                return {
                    success: false,
                    msg: 'selector, html and hash fields are required'
                };
            }

            const lastSuccessfulSelector = _successfulSuggestions.get(hash);
            if (lastSuccessfulSelector) {
                addToInvalidSuggestions(hash, lastSuccessfulSelector.selector, selector);
                _successfulSuggestions.delete(hash);
            }

            if (!isDevelopment) {
                // res.writeHead(200, {'Content-Type': 'application/json'});
                // res.end(JSON.stringify({message: 'Selector marked as invalid', hash}));
                return {
                    success: false,
                    msg: 'Selector marked as invalid'
                };
            }

            // Retry with new selector in development mode
            const newSelector = await getSelectorFromLLM({description: selector, content: html, hash: hash});
            if (!newSelector) {
                addToInvalidSuggestions(hash, "NULL", selector);
                return {
                    success: false,
                    msg: 'No selector generated'
                };
            }
            storedData[hash] = newSelector;
            _successfulSuggestions.set(hash, {
                desc: selector,
                selector: newSelector
            });

            // res.writeHead(200, {'Content-Type': 'application/json'});
            // res.end(JSON.stringify());
            return {
                success: true,
                selector: newSelector,
                hash
            }
        } catch (error) {
            console.error('Error in invalidProcessor:', error);
            return {
                success: false,
                msg: 'Unexpected error'
            }
            // res.writeHead(400, {'Content-Type': 'application/json'});
            // res.end(JSON.stringify({error: 'Invalid JSON data'}));
        }
    }

    async function getSelectorFromLLM({description, content, hash}: {
        description: string,
        content: string,
        hash: string
    }): Promise<string | null> {
        // return new Promise((resolve) => {
            const messages = _getMessages(description, content, hash);
            try {
                console.log('Sending messages to LLM:', LLM_API_URL, LLM_MODEL);
                console.log(JSON.stringify({
                    model: LLM_MODEL,
                    max_tokens: 100,
                    temperature: 1.5,
                    messages,
                    stream: false
                }));
                const response = await fetch(LLM_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${LLM_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: LLM_MODEL,
                        max_tokens: 100,
                        temperature: 1.5,
                        messages,
                        stream: false
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const llm_selector = data.choices[0].message.content.trim();
                    console.log('Generated selector:', llm_selector);
                    return llm_selector;
                } else {
                    console.error('API request failed:', response.status, await response.text());
                    return null;
                }
            } catch (e) {
                console.error('Error making API request:', e);
                return null;
            }

        // })
    }

    // Helper function to generate messages for the LLM
    function _getMessages(description: string, content: string, hash: string) {
        const failedSuggestions = Array.from(_failedSuggestions.get(hash)?.selectors || []);
        const invalidSuggestions = Array.from(_invalidSuggestions.get(hash)?.selectors || []);

        const messages = [{
            role: 'user',
            content: `
            You are an expert QA engineer.
            You will be given a description of an element and an HTML snippet. Your job
            is to locate the node or nodes that match the description and generate a CSS selector.
            Generate a selector that would work within this HTML context only (it doesn't need to be unique on the full page).
            Prioritize selectors that use any 'data-test-' attribute, 'data-testid', or 'name' attribute of the element.

            The description could be about a specific element or a group of elements. For example:
            * "The main heading of the page"  # This is a specific element
            * "The login button"  # This is a specific element
            * "The product images"  # This is a group of elements
            * "The navigation links"  # This is a group of elements

            Your instructions are to:
            * Locate the node or nodes in the HTML that match the description, then
            * If you found the node or nodes, generate the most specific CSS selector for the element or elements.
            * If you cannot locate the node or nodes, output 'NULL'.

            <CSS_SELECTOR>
            For the CSS selector, follow these guidelines:
            * Be specific. The selector should match only the node or nodes that match the description.
            * Do not go higher in the DOM tree than necessary.
            * Prioritize content nodes over layout nodes if possible.
            * The selector MUST NOT use the following CSS selectors: :has, :has-text, :text, :visible, :contains, :is or any non native CSS selector.
            * Use nth-child, nth-of-type, first-child, last-child, etc. to locate elements by index
            * Use :disabled, :checked, :enabled to locate nodes by state
            </CSS_SELECTOR>

            The selector will be used to "query()" or "queryAll()" on the root element of the page to locate the element or elements,
            so make sure the selector is valid.

            <OUTPUT>
            You should output the selector or 'NULL' if no selector is found.
            Do not include any additional text, comments or instructions in the output.
            Do not quote your response with backticks or any other characters.

            Just output the selector string or 'NULL'.
            </OUTPUT>

            <EXAMPLES>
            These are all examples of valid selectors that could be generated:

            * #main-content form input[name="username"]
            * #unique-id
            * .product-list li:nth-of-type(1)
            * [role="main"] section h1:nth-of-type(1)
            * .product-list li:nth-of-type(1) img
            * input[placeholder="Enter your username"]
            * button:contains("Submit")
            * .product-list:nth-child(4)
            * #main-form input[role="textbox"]
            * [data-qa="username-input"]
            * [aria-label="Username Input"]
            * input[type="checkbox"]:disabled
            * input[type="checkbox"]:checked
            * a[href="/login"]

            </EXAMPLES>`
        },
            {
                role: 'user',
                content: `The description is: ${description}`
            },
            {
                role: 'user',
                content: `The HTML snippet is:\n<PAGE>\n${content}\n</PAGE>`
            }];

        invalid:{
            if (!invalidSuggestions) break invalid;
            let count = 0;
            for (let i = 0; i < invalidSuggestions.length; i++) {


                const selector = invalidSuggestions[i];
                if (!selector) continue;


                messages.push({
                    role: 'assistant',
                    content: selector
                });

                messages.push({
                    role: 'user',
                    content: count++ === 0 ?
                        'This selector was not valid. Try a different one.'
                        : 'This selector was also not valid. Try a different one.'
                });
            }
        }
        failed:{
            if (!failedSuggestions) break failed;
            let count = 0;
            for (let i = 0; i < failedSuggestions.length; i++) {


                const selector = failedSuggestions[i];
                if (!selector) continue;


                messages.push({
                    role: 'assistant',
                    content: selector
                });

                messages.push({
                    role: 'user',
                    content: count++ === 0 ?
                        'That selector did not work. Please try a different approach.'
                        : 'That selector also did not work. Please try a different approach.'
                });
            }
        }

        // Add the final assistant message
        messages.push({
            role: 'assistant',
            content: 'The generated selector is:'
        });

        return messages;
    }

    function syncToFile() {
        if (fileStorageMode && selectorFilePath) {
            return saveSelectorsToFile(selectorFilePath);
        }
        return false;
    }

}

// Add these helper functions
function addToFailedSuggestions(hash: string, selector: string, aiDesc: string) {
    if (!_failedSuggestions.has(hash)) {
        _failedSuggestions.set(hash, { desc: aiDesc, selectors: new Set<string>() });
    }
    _failedSuggestions.get(hash)?.selectors?.add(selector);
}

function addToInvalidSuggestions(hash: string, selector: string, aiDesc: string) {
    if (!_invalidSuggestions.has(hash)) {
        _invalidSuggestions.set(hash, { desc: aiDesc, selectors: new Set<string>() });
    }
    _invalidSuggestions.get(hash)?.selectors?.add(selector);
}

// File operations for selectors
function saveSelectorsToFile(filePath: string): boolean {
    try {
        const selectorData: SelectorData = {};

        // Convert successful suggestions to the required format
        for (const [hash, selector] of _successfulSuggestions.entries()) {
            selectorData[hash] = {
                desc: selector.desc, // Default description
                selector: selector.selector || "NULL"
            };
        }

        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Write to file
        fs.writeFileSync(filePath, JSON.stringify(selectorData, null, 2));
        console.log(`Selectors saved to ${filePath}`);
        return true;
    } catch (error) {
        console.error('Error saving selectors to file:', error);
        return false;
    }
}

function loadSelectorsFromFile(filePath: string): boolean {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            const selectorData: SelectorData = JSON.parse(data);

            // Clear current data to ensure sync
            _successfulSuggestions.clear();

            // Update the in-memory maps with loaded data
            for (const [hash, data] of Object.entries(selectorData)) {
                if (data.selector && data.selector !== "NULL") {
                    storedData[hash] = data.selector;
                    _successfulSuggestions.set(hash, {
                        desc: data.desc,
                        selector: data.selector
                    });
                }
            }

            console.log(`${Object.keys(selectorData).length} selectors loaded from ${filePath}`);
            return true;
        } else {
            // Try to create the file if it doesn't exist
            try {
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
                console.log(`Created empty selectors file at ${filePath}`);
                return true;
            } catch (createError) {
                console.error('Error creating selectors file:', createError);
                return false;
            }
        }
    } catch (error) {
        console.error('Error loading selectors from file:', error);
        return false;
    }
}
