type LLM_MSG = {
    role: string,
    content: string
}

type LLM_MSGs = Array<LLM_MSG>;

type args = {
    aiDesc: string,
    html: string
}

/* eslint-disable no-unexpected-multiline */
/* eslint-disable no-unused-expressions */
export default {
    // Constants
    // LLM_API_URL: '<PLACEHOLDER>',
    // LLM_MODEL: '<PLACEHOLDER>',
    // LLM_API_KEY: '<PLACEHOLDER>',  // Will be replaced at runtime
    CACHE_SERVER_PORT: '<PLACEHOLDER>',

    // Store failed suggestions per root+description combination
    // _failedSuggestions: {} as Record<string, Set<string>>,

    // Store successful suggestions per root+description combination
    _successfulSuggestions: {} as Record<string, Set<string>>,

    // Store invalid suggestions (syntactically incorrect) per root+description combination
    // _invalidSuggestions: {} as Record<string, Set<string>>,

    _cleanup(root: HTMLElement) {
        console.log("Filtering non-relevant elements");
        let ret = this._filterNonRelevantElements(root);
        console.log("Removing comments");
        ret = this._removeComments(ret);
        console.log("Removing non-important attributes");
        ret = this._removeNonImportantAttributes(ret);
        return ret;
    },

    // Helper function to filter out non-relevant elements from the root
    _filterNonRelevantElements(root: HTMLElement) {
        // Clone the root element to preserve the original
        const clonedRoot = root.cloneNode(true) as HTMLElement;
        console.log('Original length', root.getHTML().length);

        // Remove <script>, <style>, and <noscript> elements in the clone
        const unwantedTags = ['script', 'style', 'noscript', 'link', 'meta', 'iframe', 'object', 'embed'];

        unwantedTags.forEach(tag => {
            const elements = clonedRoot.querySelectorAll(tag);
            elements.forEach(element => element.remove());
        });

        console.log('Parsed length', clonedRoot.getHTML().length);
        return clonedRoot;
    },

    // Helper function to remove comments from the root
    _removeComments(root: HTMLElement) {
        // Clone the root element to preserve the original
        const clonedRoot = root.cloneNode(true) as HTMLElement;
        console.log('Original length', root.getHTML().length);

        // Remove comments from the clone
        const comments = clonedRoot.querySelectorAll('*');
        comments.forEach(element => {
            if (element.nodeType === Node.COMMENT_NODE) {
                element.remove();
            }
        });

        console.log('Parsed length', clonedRoot.getHTML().length);
        return clonedRoot;
    },

    // Helper function to non important attributes
    _removeNonImportantAttributes(root: HTMLElement) {
        // Clone the root element to preserve the original
        const clonedRoot = root.cloneNode(true) as HTMLElement;
        console.log('Original length', root.getHTML().length);

        // Remove non important attributes from the clone
        const importantAttributes = [
            'id',
            'class',
            'name',
            'data-*',
            'role',
            'type',
            'aria-*',
            'href'
        ];

        // Remove all attributes except the important ones
        const elements = clonedRoot.querySelectorAll('*');
        elements.forEach(element => {
            const attributes = Array.from(element.attributes);
            attributes.forEach(attr => {
                if (!importantAttributes.some(ia => new RegExp(ia).test(attr.name))) {
                    element.removeAttribute(attr.name);
                }
            });
        });

        console.log('Parsed length', clonedRoot.getHTML().length);
        return clonedRoot;
    },

    // Helper function to get a unique key for root+description combination
    _getKey({aiDesc, html}:args) {
        return `${html}:::${aiDesc}`;
    },

    // Helper function to record a failed suggestion
    // _recordFailedSuggestion(content: string, description: string, selector: string) {
    //     const key = this._getKey(content, description);
    //     if (!this._failedSuggestions[key]) {
    //         this._failedSuggestions[key] = new Set();
    //     }
    //     this._failedSuggestions[key].add(selector);
    // },

    // Helper function to record a successful suggestion
    _recordSuccessfulSuggestion({aiDesc, html}:args, selector: string) {
        const key = this._getKey({aiDesc, html});
        if (!this._successfulSuggestions[key]) {
            this._successfulSuggestions[key] = new Set();
        }
        this._successfulSuggestions[key].add(selector);
    },

    // Helper function to record an invalid suggestion
    // _recordInvalidSuggestion(content: string, description: string, selector: string) {
    //     const key = this._getKey(content, description);
    //     if (!this._invalidSuggestions[key]) {
    //         this._invalidSuggestions[key] = new Set();
    //     }
    //     this._invalidSuggestions[key].add(selector);
    // },

    // Helper function to get failed suggestions
    // _getFailedSuggestions(content: string, description: string) {
    //     const key = this._getKey(content, description);
    //     return Array.from(this._failedSuggestions[key] || []);
    // },

    _getSuccessfulSuggestions({aiDesc, html}:args) {
        const key = this._getKey({aiDesc, html});
        return Array.from(this._successfulSuggestions[key] || []);
    },

    // Helper function to get invalid suggestions
    // _getInvalidSuggestions(content: string, description: string) {
    //     const key = this._getKey(content, description);
    //     return Array.from(this._invalidSuggestions[key] || []);
    // },


    _getSelector({aiDesc, html}:args): string | null {
        // todo
        // send post to cacheserver
        // return selector
        //     Check if we have any successful suggestions first
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `http://localhost:${this.CACHE_SERVER_PORT}/selector`, false);  // false makes it synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');
        // xhr.setRequestHeader('Authorization', `Bearer ${this.LLM_API_KEY}`);

        // const response = await fetch('http://localhost:3000/create', {
        //     method: 'POST',
        //     headers: {
        //         'Content-Type': 'application/json',
        //     },
        //     body: JSON.stringify({selector, html}),
        // });
        // const data = await response.json();
        // return data.selector;

        const data = {selector: aiDesc, html};

        try {
            xhr.send(JSON.stringify(data));
            if (xhr.status === 200) {
                console.log(`responseText => `,xhr.responseText);
                const response = JSON.parse(xhr.responseText);
                console.log(`response => `,response);
                const llm_selector = response.selector;// .choices[0].message.content.trim();
                console.log('Generated selector:', llm_selector);
                return llm_selector;
            } else {
                console.error('API request failed:', xhr.status, xhr.responseText);
                return null;
            }
        } catch (e) {
            console.error('Error making API request:', e);
            return null;
        }
    },

    // Helper function to make sync HTTP request to LLM
    // _llm(messages: LLM_MSGs) {
    //     // Check if we have any successful suggestions first
    //     // const xhr = new XMLHttpRequest();
    //     // xhr.open('POST', this.LLM_API_URL, false);  // false makes it synchronous
    //     // xhr.setRequestHeader('Content-Type', 'application/json');
    //     // xhr.setRequestHeader('Authorization', `Bearer ${this.LLM_API_KEY}`);
    //     //
    //     // const data = {
    //     //     model: this.LLM_MODEL,
    //     //     max_tokens: 100,
    //     //     temperature: 1.5,
    //     //     messages,
    //     //     stream: false
    //     // };
    //     //
    //     // try {
    //     //     xhr.send(JSON.stringify(data));
    //     //     if (xhr.status === 200) {
    //     //         const response = JSON.parse(xhr.responseText);
    //     //         const llm_selector = response.choices[0].message.content.trim();
    //     //         console.log('Generated selector:', llm_selector);
    //     //         return llm_selector;
    //     //     } else {
    //     //         console.error('API request failed:', xhr.status, xhr.responseText);
    //     //         return null;
    //     //     }
    //     // } catch (e) {
    //     //     console.error('Error making API request:', e);
    //     //     return null;
    //     // }
    // },

    // Returns the first element matching given selector in the root's subtree.
    query(root: HTMLElement | Document, selector: string) {
        console.log('%c AI Selector: Starting query', 'background: #222; color: #bada55');
        console.log('Root:', root);
        console.log('Selector:', selector);

        try {
            // Get the root content instead of entire DOM
            const elem = ("documentElement" in root && root.documentElement ? root.documentElement.querySelector('body') : root) as HTMLElement;
            if (!elem) throw new Error('No body element found');
            const content = this._cleanup(elem).getHTML();

            // Check if we have any successful suggestions first
            const successfulSuggestions = this._getSuccessfulSuggestions({html:content, aiDesc: selector});
            if (successfulSuggestions.length > 0) {
                console.log('Using cached successful selector:', successfulSuggestions[0]);
                return successfulSuggestions[0];
            }

            // Get selectors from LLM
            // const messages = this._getMessages(selector, content);
            // const llm_selector = this._llm(messages);
            const llm_selector = this._getSelector({html: content, aiDesc: selector});

            if (!llm_selector || llm_selector === 'NULL') {
                console.error('No selector generated');
                return null;
            }

            try {
                console.log('Trying selector:', llm_selector);
                const element = root.querySelector(llm_selector);
                if (element) {
                    console.log('%c Found element!', 'background: green; color: white', {
                        selector: llm_selector,
                        element: element
                    });
                    // this._recordSuccessfulSuggestion(content, selector, llm_selector);
                    return element;
                }
                console.log('No element found with selector:', llm_selector);
                // Record the failed suggestion
                this.markSelectorAsFailed({aiDesc: selector, html: content, hash: llm_selector});
                return null;
            } catch (e) {
                console.error('Error with selector:', llm_selector, e);
                // Record the invalid suggestion since it caused an error
                this.markSelectorAsInvalid({aiDesc:selector, html: content, hash: llm_selector});
                return null;
            }
        } catch (e) {
            console.error('Error in query:', e);
            return null;
        }
    },

    // Returns all elements matching given selector in the root's subtree.
    queryAll(root: HTMLElement | Document, selector: string) {
        console.log('%c AI Selector: Starting queryAll', 'background: #222; color: #bada55');
        console.log('Root:', root);
        console.log('Selector:', selector);

        try {
            // Get the root content instead of entire DOM
            const elem = (root instanceof Document /*"documentElement" in root && root.documentElement*/) ? root.documentElement.querySelector<HTMLBodyElement>('body') : root;
            if (!elem) throw new Error('No body element found');
            const content = this._cleanup(elem).getHTML();

            // Check if we have any successful suggestions first
            const successfulSuggestions = this._getSuccessfulSuggestions({aiDesc: selector, html: content});
            if (successfulSuggestions.length > 0) {
                console.log('Using cached successful selector:', successfulSuggestions[0]);
                this._recordSuccessfulSuggestion({aiDesc:selector, html:content}, successfulSuggestions[0]);
                return successfulSuggestions[0];
            }

            // Get selectors from LLM
            // const messages = this._getSelector(selector, content);
            // const llm_selector = this._llm(messages);
            const llm_selector = this._getSelector({aiDesc: selector, html: content});

            if (!llm_selector || llm_selector === 'NULL') {
                console.error('No selector generated');
                return [];
            }

            const elements = new Set();
            try {
                console.log('Trying selector:', llm_selector);
                const found = root.querySelectorAll(llm_selector);
                if (found.length > 0) {
                    console.log('%c Found elements!', 'background: green; color: white', {
                        selector: llm_selector,
                        count: found.length
                    });
                    found.forEach(el => elements.add(el));
                } else {
                    console.log('No elements found with selector:', llm_selector);
                    // Record the failed suggestion
                    this.markSelectorAsFailed({aiDesc: selector, html: content, hash: llm_selector});
                }
                return Array.from(elements);
            } catch (e) {
                console.error('Error with selector:', llm_selector, e);
                // Record the invalid suggestion since it caused an error
                this.markSelectorAsInvalid({aiDesc: selector, html: content, hash: llm_selector});
                return [];
            }
        } catch (e) {
            console.error('Error in queryAll:', e);
            return [];
        }
    },
    async getSelector({aiDesc, html}:args): Promise<string> {
        const response = await fetch('http://localhost:3000/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({selector:aiDesc, html}),
        });
        const data = await response.json();
        return data.selector;
    },

    markSelectorAsFailed({aiDesc, html, hash}:args & {  hash: string }): string | null {

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `http://localhost:${this.CACHE_SERVER_PORT}/failed`, false);  // false makes it synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');

        const data = {selector: aiDesc, html, hash};

        try {
            xhr.send(JSON.stringify(data));
            if (xhr.status === 200) {
                console.log(`responseText => `,xhr.responseText);
                const response = JSON.parse(xhr.responseText);
                console.log(`response => `,response);
                const llm_selector = response.selector;// .choices[0].message.content.trim();
                console.log('Generated selector:', llm_selector);
                return llm_selector;
            } else {
                console.error('API request failed:', xhr.status, xhr.responseText);
                return null;
            }
        } catch (e) {
            console.error('Error making API request:', e);
            return null;
        }

        // await fetch('http://localhost:3000/failed', {
        //     method: 'POST',
        //     headers: {
        //         'Content-Type': 'application/json',
        //     },
        //     body: JSON.stringify({selector: aiDesc, html, hash}),
        // });
    },

    markSelectorAsInvalid({aiDesc, html, hash}:args & {  hash: string }): string | null {
        // await fetch('http://localhost:3000/invalid', {
        //     method: 'POST',
        //     headers: {
        //         'Content-Type': 'application/json',
        //     },
        //     body: JSON.stringify({selector: aiDesc, html, hash}),
        // });

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `http://localhost:${this.CACHE_SERVER_PORT}/invalid`, false);  // false makes it synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');

        const data = {selector: aiDesc, html, hash};

        try {
            xhr.send(JSON.stringify(data));
            if (xhr.status === 200) {
                console.log(`responseText => `,xhr.responseText);
                const response = JSON.parse(xhr.responseText);
                console.log(`response => `,response);
                const llm_selector = response.selector;// .choices[0].message.content.trim();
                console.log('Generated selector:', llm_selector);
                return llm_selector;
            } else {
                console.error('API request failed:', xhr.status, xhr.responseText);
                return null;
            }
        } catch (e) {
            console.error('Error making API request:', e);
            return null;
        }
    }
}
