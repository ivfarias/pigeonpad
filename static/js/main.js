//> ## Pigeonpad's editor component

const {
    StyledComponent,
    Record,
    Router,
} = Torus;

//> Utility function to fetch while bypassing the cache, and with some
//  default options.
const cfFetch = (uri, options) => {
    return fetch(uri, {
        credentials: 'same-origin',
        ...options,
    });
}

//> This `api` object provides some utility methods we use to fetch
//  and push stuff to and from the Pigeonpad internal API.
const api = {
    get: path => cfFetch(`/api${path}`, {
        method: 'GET',
    }),
    post: (path, body) => cfFetch(`/api${path}`, {
        method: 'POST',
        body: body,
    }),
    errlog: e => console.error(`Pigeonpad API error:\n\t${e}`),
}

//> Debounce coalesces multiple calls to the same function in a short
//  period of time into one call, by cancelling subsequent calls within
//  a given timeframe.
const debounce = (fn, delayMillis) => {
    let lastRun = 0;
    let to = null;
    return (...args) => {
        clearTimeout(to);
        const now = Date.now();
        const dfn = () => {
            lastRun = now;
            fn(...args);
        }
        if (now - lastRun > delayMillis) {
            dfn()
        } else {
            to = setTimeout(dfn, delayMillis);
        }
    }
}

//> The `PreviewPane`  is the half-screen pane that shows a preview of the
//  rendered Pigeonpad, alongside the URL and refresh buttons.
class PreviewPane extends StyledComponent {

    init(frameRecord) {
        //> Percentage of the editor size that the preview pane takes up.
        this.paneWidth = 50;

        //> We create an iframe manually and insert it into the component DOM,
        //  so we can replace its URL when the preview URL changes, rather than
        //  simply having Torus set it and adding unnecessary history entries in the browser.
        this.iframe = document.createElement('iframe');
        this.iframe.setAttribute('frameborder', 0);

        this.bind(frameRecord, data => this.render(data));

        this.selectInput = this.selectInput.bind(this);
        this.handleRefresh = this.handleRefresh.bind(this);
    }

    setWidth(width) {
        this.paneWidth = width;
        this.render();
    }

    styles() {
        return css`
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: flex-start;
        height: 100%;
        flex-grow: 1;
        flex-shrink: 1;
        overflow: hidden;
        border-right: 2px solid var(--cf-black);
        @media (max-width: 750px) {
            /* Overriding inline style */
            width: 100% !important;
            height: 50%;
            border-right: 0;
            border-bottom: 2px solid var(--cf-black);
        }
        .topBar {
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: center;
            width: 100%;
            padding: 0 3px;
            border-bottom: 4px dotted var(--cf-black);
            flex-shrink: 0;
            height: 52px;
            .embedded & {
                background: var(--cf-background);
            }
            .inputContainer {
                box-sizing: content-box;
                flex-grow: 1;
                flex-shrink: 1;
            }
            input {
                display: block;
                font-size: .75rem;
                font-weight: bold;
                height: 100%;
                width: 100%;
                box-shadow: none;
                outline: none;
                border: 0;
                padding: 0;
                font-weight: normal;
                font-family: 'Menlo', 'Monaco', monospace;
            }
            a {
                font-size: .75rem;
                flex-grow: 0;
            }
        }
        iframe {
            height: 100%;
            width: 100%;
            flex-grow: 1;
            outline: none;
            border: 0;
            box-shadow: none;
            flex-shrink: 1;
        }
        .refreshButton {
            font-size: 17px;
            width: calc(.75rem + 17px);
            height: calc(.75rem + 17px);
            line-height: calc(.75rem + 18px);
            flex-shrink: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            &:active {
                color: #000;
            }
        }
        .unsavedWarning {
            font-style: italic;
            white-space: nowrap;
            .button {
                font-style: initial;
                cursor: not-allowed;
            }
        }
        `;
    }

    selectInput(evt) {
        evt.preventDefault();
        evt.target.select();
        //> This is a weird and funky workaround for the fact that, in Safari, the selection
        //  made here from a focus event is cancelled immediately by a proceeding mouseup event,
        //  when it happens. So we `.preventDefault()` only the next immediate mouseup event.
        const cancelMouseup = e => {
            e.preventDefault();
            evt.target.removeEventListener('mouseup', cancelMouseup);
        };
        evt.target.addEventListener('mouseup', cancelMouseup);
        gevent('preview', 'selecturl');
    }

    handleRefresh() {
        //> Force-refreshing the preview works by clearing the "last url"
        //  fetched, so it looks like the same URL is a new URL on next render.
        this._lastURL = '';
        this.render();
        gevent('preview', 'refresh');
    }

    safelySetIframeURL(url) {
        //> If the iframe already has content, we want to replace its uri; if not,
        //  we want to give it a uri. This takes care of this logic.
        if (this._lastURL !== url) {
            //> If we simply assign to `iframe.src` property here, it adds an entry to the parent
            //  page's back/forward history, which we don't want. We only want to add to `src` if
            //  the iframe does not already have a page loaded (i.e. when `contentWindow` is null).
            if (this.iframe.contentWindow) {
                this.iframe.contentWindow.location.replace(url);
            } else {
                this.iframe.src = url;
            }
            this._lastURL = url;
        }
    }

    compose(data) {
        //> If we're not rendering from a saved Pigeonpad from the server but instead rendering
        //  a "live" preview, generate a data URI instead and point the iframe to that. Otherwise,
        //  just use the URL to the saved preview.
        let url = '';
        if (data.liveRenderMarkup === null) {
            url = `${window.location.origin}/f/${data.htmlFrameHash}/${data.jsFrameHash}.html`;
        } else {
            url = 'data:text/html,' + encodeURIComponent(data.liveRenderMarkup);
        }
        this.safelySetIframeURL(url);

        //> We compare the new URL to the old URL here, to see whether we need to reset the `src`
        //  attribute on the iframe. If it's unchanged, we leave the iframe alone.
        return jdom`<div class="previewPanel" style="width:${this.paneWidth}%">
            ${data.liveRenderMarkup === null ? (
                jdom`<div class="topBar">
                    <div class="fixed button inputContainer">
                        <input value="${url}" onfocus="${this.selectInput}" />
                    </div>
                    <button class="button refreshButton" title="Refresh preview"
                        onclick="${this.handleRefresh}">↻</button>
                    <a class="button previewButton" title="Open preview in new tab"
                        target="_blank" href="${url}">Preview</a>
                </div>`
            ) : (
                jdom`<div class="topBar">
                    <div class="unsavedWarning">
                        tap
                        <div class="fixed inline button">Save ${'&'} Reload</div>
                        to share <span class="mobile-hidden">→</span>
                    </div>
                </div>`
            )}
            ${this.iframe}
        </div>`;
    }

}

//> Shorthand function that inserts a script tag with a given source and
//  returns a promise that resolves when the script is loaded and evaluated.
//  We use this as a minimal module loader to bootstrap loading of editor modules.
const loadScript = url => {
    const tag = document.createElement('script');
    tag.src = url;
    tag.async = true;
    return new Promise((res, _rej) => {
        tag.addEventListener('load', res);
        document.body.appendChild(tag);
    });
}

//> ## Editor implementations

//> Pigeonpad uses multiple different editor backends (`EditorCore` implementations)
//  to implement the actual code editor part of Pigeonpad. This is because...
//
//  1. It reduces reliance on one particular third-party editor.
//  2. It creates an interface under which new editor backends can be added / experimented with.
//  3. Different editor backends are best suited for different clients.
//
//  We currently use two backends, Visual Studio Code's Monaco editor, which also runs CodeSandbox; and
//  CodeMirror, which powers Glitch, Chrome DevTools, and more. You can also find a
//  _reference implementation_ of a bare-bones editor built on `<textarea>` in `static/js/editors/textarea.js`.

//> Monaco-based implementation of `EditorCore`
class MonacoEditor {

    constructor(callback) {
        this.mode = 'html';

        //> Frames are temporary storage of loaded / saved Pigeonpad source files
        //  before the editor itself has been loaded and initialized.
        this.frames = {
            html: '',
            javascript: ``,
        }
        //> Monaco's core data structure backing each source file in the editor is
        //  the "model". Each model represents and holds edit data, history, etc. for
        //  one file. We keep track of two and swap between them in one editor instance.
        this.models = {
            html: null,
            javascript: null,
        }

        this.container = document.createElement('div');
        this.container.classList.add('editorContainer');
        this.monacoEditor = null;

        //> See `setValue()` to see why this exists.
        this._beingSetProgrammatically = false;

        //> Load the core editor module loader, and begin bootstrapping the Monaco
        //  editor loading process.
        loadScript('https://unpkg.com/monaco-editor/min/vs/loader.js').then(() => this._loadEditor(callback));
    }

    //> Loads the rest of the Monaco editor source code and initializes the editor.
    _loadEditor(callback) {
        require.config({
            paths: {
                vs: 'https://unpkg.com/monaco-editor/min/vs',
            },
        });
        require(['vs/editor/editor.main'], () => {
            //> Initialize models for both files
            this.models.html = monaco.editor.createModel(this.frames.html, 'html');
            this.models.javascript = monaco.editor.createModel(this.frames.javascript, 'javascript');

            //> Define a custom theme
            monaco.editor.defineTheme('cf-default', {
                base: 'vs',
                inherit: true,
                rules: [
                    { token: '', foreground: '000000', background: 'ffffff' },
                    { token: 'comment', foreground: '888888', fontStyle: 'italic' },

                    //> Javascript-related highlights
                    { token: 'keyword', foreground: '3436bb', fontStyle: 'bold' },
                    { token: 'type', foreground: '038c6e' },
                    { token: 'string', foreground: 'b31515' },
                    { token: 'number', foreground: 'ec6a40' },

                    //> HTML/CSS-related highlights
                    { token: 'tag', foreground: '038c6e' },
                    { token: 'attribute.name', foreground: 'e40132' },
                    { token: 'attribute.value.html', foreground: '3436bb' },
                ],
                colors: {
                    'editor.background': '#ffffff',
                    'editor.lineHighlightBorder': '#f8f8f8',
                    'editor.lineHighlightBackground': '#f8f8f8',
                    'editorLineNumber.foreground': '#888888',
                    'editorLineNumber.activeForeground': '#333333',
                    'editorIndentGuide.background': '#ffffff',
                    'editorIndentGuide.activeBackground': '#ffffff',
                },
            });
            monaco.editor.setTheme('cf-default');

            //> Create one editor instance, in which we can swap between
            //  the two source file models being edited.
            this.monacoEditor = monaco.editor.create(this.container, {
                fontFamily: "'Menlo', 'Monaco', monospace",
            });
            this.setMode(this.mode);

            callback(this);
        });
    }

    _registerKeybindings(callbacks) {
        //> For Monaco specifically, we capture the Ctrl/Cmd-S shortcut and call save
        //  on the frames being edited. This is specific to Monaco because CodeMirror does
        //  not currently have a way to extend the editor keybindings.
        //  We _could_ also try to listen for different keyboard events in `Workspace` and
        //  respond accordingly from there, but that would lead to inconsistencies
        //  between browsers/OS vendors and it would depend on the editor bubbling
        //  events up.
        this.monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_S, callbacks.save);
    }

    //> The following interface methods are shared between all `EditorCore` implementations

    getValue(mode = this.mode) {
        if (this.ready()) {
            return this.models[mode].getValue();
        } else {
            return this.frames[mode];
        }
    }

    setValue(value, mode = this.mode) {
        if (this.ready()) {
            if (this.models[mode].getValue() !== value) {
                //> Monaco doesn't have the ability to distinguish between changes to editor
                //  content that happens because of user-initiated edits vs. programmatic
                //  edits using `setValue()`. Since we only want to fire change event handlers
                //  for the former kind of change, we keep track of the "is this a programmatic
                //  change" state in this variable.
                this._beingSetProgrammatically = true;
                this.models[mode].setValue(value);
                this._beingSetProgrammatically = false;
            }
        } else {
            this.frames[mode] = value;
        }
    }

    getMode() {
        return this.mode;
    }

    setMode(mode) {
        this.mode = mode;
        if (this.ready()) {
            this.monacoEditor.setModel(this.models[mode]);
        }
    }

    addChangeHandler(handler) {
        if (this.ready()) {
            const userChangeHandler = () => {
                if (!this._beingSetProgrammatically) {
                    handler();
                }
            }
            //> In Monaco, there isn't change events in the editor, but
            //  instead change events in the models, which we listen for.
            this.models.html.onDidChangeContent(userChangeHandler);
            this.models.javascript.onDidChangeContent(userChangeHandler);
        }
    }

    getContainer() {
        return this.container;
    }

    resize() {
        if (this.ready()) {
            this.monacoEditor.layout();
        }
    }

    ready() {
        return this.monacoEditor !== null;
    }

}

//> CodeMirror-based implementation of `EditorCore`, which is enabled on mobile browsers
//  because Monaco is not mobile browser-compatible. This implementation is also slightly
//  faster on slower networks.
class CodeMirrorEditor {

    constructor(callback) {
        this.mode = 'html';

        this.frames = {
            html: '',
            javascript: ``,
        }
        //> The Document is CodeMirror's data structure for storing file and editor
        //  contents, edit history, etc. To swap between files / modes, we swap between
        //  these two documents.
        this.documents = {
            html: null,
            javascript: null,
        }

        this.container = document.createElement('div');
        this.container.classList.add('editorContainer');
        this.codeMirrorEditor = null;

        //> This bootstraps the loading process for the CodeMirror editor.
        this._loadEditor(callback);
    }

    async _loadEditor(callback) {
        //> We fix the version number here because CM 6 is going to have breaking
        //  API changes, and it's unclear at time of writing if that'll be released under
        //  the same package.
        const EDITOR_SCRIPT_ROOT = 'https://unpkg.com/codemirror@5';
        const EDITOR_SCRIPT_SRC = EDITOR_SCRIPT_ROOT + '/lib/codemirror.js';
        const LANG_SCRIPT_SRC = [
            'javascript',
            //> `xml` and `css` are dependencies of `htmlmixed`, the standalone
            //  (not embedded) HTML language mode for CM.
            'xml',
            'css',
            'htmlmixed',
        ].map(mode => `${EDITOR_SCRIPT_ROOT}/mode/${mode}/${mode}.js`);
        const AUX_SRC = [
            'edit/closetag.js',
            'edit/closebrackets.js',
        ].map(path => `${EDITOR_SCRIPT_ROOT}/addon/${path}`);

        //> CodeMirror has an accompanying stylesheet. We load this manually here.
        const styleLink = document.createElement('link');
        styleLink.rel = 'stylesheet';
        styleLink.href = EDITOR_SCRIPT_ROOT + '/lib/codemirror.css';
        document.head.appendChild(styleLink);

        //> These must load in this order -- language modes must load
        //  after the core editor is loaded, but once the core editor
        //  is loaded, everything else can load in parallel.
        await loadScript(EDITOR_SCRIPT_SRC);
        await Promise.all([
            ...LANG_SCRIPT_SRC,
            ...AUX_SRC,
        ].map(loadScript));

        this.documents.html = CodeMirror.Doc(this.frames.html, 'htmlmixed');
        this.documents.javascript = CodeMirror.Doc(this.frames.javascript, 'javascript');

        this.codeMirrorEditor = CodeMirror(this.container, {
            indentUnit: 4,
            tabSize: 4,
            lineWrapping: false,
            lineNumbers: true,
            indentWithTabs: true,

            // provided by edit/closetag.js
            autoCloseTags: true,

            // provided by edit/closebrackets.js
            autoCloseBrackets: true,
        });
        //> We swap the document in after instantiation rather than in creation,
        //  because the latter option strips the document of its language mode.
        //  This seems like a poorly documented behavior of CM.
        this.setMode(this.mode);

        callback(this);
    }

    getValue(mode = this.mode) {
        if (this.ready()) {
            return this.documents[mode].getValue();
        } else {
            return this.frames[mode];
        }
    }

    setValue(value, mode = this.mode) {
        if (this.ready()) {
            if (this.documents[mode].getValue() !== value) {
                this.documents[mode].setValue(value);
            }
        } else {
            this.frames[mode] = value;
        }
    }

    getMode() {
        return this.mode;
    }

    setMode(mode) {
        this.mode = mode;
        if (this.ready()) {
            this.codeMirrorEditor.swapDoc(this.documents[mode]);
        }
    }

    addChangeHandler(handler) {
        if (this.ready()) {
            this.codeMirrorEditor.on('changes', (_, changeEvent) => {
                //> We want to avoid triggering change events not generated directly
                //  from user input. i.e. we don't want to hit change handlers when we
                //  reload or reroute.
                if (changeEvent[0].origin !== 'setValue') {
                    handler();
                }
            });
        }
    }

    getContainer() {
        return this.container;
    }

    resize() {
        this.codeMirrorEditor.setSize();
    }

    ready() {
        return this.codeMirrorEditor !== null;
    }

}

//> Depending on the client, pick the editor implementation that provides the best experience.
const EditorCore = navigator.userAgent.match(/(Android|iPhone|iPad|iPod)/) ? CodeMirrorEditor : MonacoEditor;

//> The `Editor` component encapsulates the editor (currently Monaco
//  or CodeMirror), all file state and undo/redo histories, syntax highlights
//  and other state about the files the user is editing.
class Editor extends StyledComponent {

    init(frameRecord) {
        //> Percentage of the editor size that the editor pane takes up.
        this.paneWidth = 50;

        //> Initial values for extra settings
        this.settings = {
            //> Is the config bar visible?
            visible: false,
            //> Is the as-you-type live reload enabled?
            asYouTypeEnabled: true,
        }

        //> Frame hashes of the last-saved editor values, to see if we need to re-fetch
        //  frame file values when the route changes.
        this._lastHash = '';
        this.initEditorCore();

        this.bind(frameRecord, data => {
            this.fetchFrames(data);
            this.render(data);
        });

        //> We deep link to the editor tab using the URL hash,
        //  so restore the state here from when the page first loaded.
        if (loadedURLState.tab !== '') {
            this.switchMode(loadedURLState.tab);
        }

        //> Any calls to `resizeEditor` should be debounced to 250ms. This is negligible
        // to UX in fast modern laptops, but has a noticeable impact on UX for lower-end devices.
        this.resizeEditor = debounce(this.resizeEditor.bind(this), 250);
        window.addEventListener('resize', this.resizeEditor);

        //> We create these two methods that are versions of `switchMode`
        //  bound to specific editing modes, for easier use later on in `compose()`.
        this.switchHTMLMode = this.switchMode.bind(this, 'html');
        this.switchJSMode = this.switchMode.bind(this, 'javascript');
        this.saveFrames = this.saveFrames.bind(this);

        //> Bind other methods used as callbacks
        this.toggleSettings = this.toggleSettings.bind(this);
        this.toggleAsYouType = this.toggleAsYouType.bind(this);

        //> Live-rendering (previewing unsaved changes) should be debounced, since we don't
        //  want to re-render the iframe with every keystroke, for example. But we leave an
        //  escape hatch with *Immediate for forced re-renders, etc.
        this.liveRenderFramesImmediate = this.liveRenderFrames.bind(this);
        this.liveRenderFrames = debounce(this.liveRenderFramesImmediate, 750);
    }

    remove() {
        window.removeEventListener('resize', this.resizeEditor)
    }

    setWidth(width) {
        this.paneWidth = width;
        this.resizeEditor();
        this.render();
    }

    fetchFrames(data) {
        //> `fetchFrames` is in charge of (1) determining based on new data whether we need to
        //  re-fetch HTML and JS files for the current version of the Pigeonpad (or if we have it already)
        //  and making those requests and saving the results to the view state. We are careful here
        //  to first check if the frames we are looking to fetch aren't the ones already saved in the editor.
        if (
            data.htmlFrameHash + data.jsFrameHash !== this._lastHash
            && data.htmlFrameHash
        ) {
            this._lastHash = data.htmlFrameHash + data.jsFrameHash;
            api.get(`/frame/${data.htmlFrameHash}`).then(resp => {
                return resp.text();
            }).then(result => {
                //> This checks against a race bug, where more recent "live" edits have
                //  been made since we began to fetch frames.
                if (this.record.get('liveRenderMarkup') === null) {
                    this.core.setValue(result, 'html');
                }
            }).catch(e => api.errlog(e));

            api.get(`/frame/${data.jsFrameHash}`).then(resp => {
                return resp.text();
            }).then(result => {
                //> This checks against a race bug. See above.
                if (this.record.get('liveRenderMarkup') === null) {
                    this.core.setValue(result, 'javascript');
                }
            }).catch(e => api.errlog(e));
        }
    }

    //> Initialize the given editor implementation.
    initEditorCore() {
        this.core = new EditorCore(core => {
            //> Here we populate potential prefilled values from the URL query strings,
            //  and force-live-render it into the preview to make those dirty changes
            //  visible without saving these examples to the server.
            if (loadedURLState.html || loadedURLState.js) {
                core.setValue(loadedURLState.html, 'html');
                core.setValue(loadedURLState.js, 'javascript');
                this.liveRenderFramesImmediate();
            }
            core.addChangeHandler(this.liveRenderFrames);

            // Monaco-specific, so this isn't super clean, but is the best
            // solution I could come up with without breaking encapsulation
            // of the EditorCore interface..
            if ('_registerKeybindings' in core) {
                core._registerKeybindings({
                    save: this.saveFrames,
                });
            }

            this.render();
            this.resizeEditor();
        });
    }

    resizeEditor() {
        this.core.resize();
    }

    switchMode(mode) {
        //> When we switch modes, we have to first save the value of the file being
        //  edited, then switch out the underlying file model.
        this.core.setMode(mode);
        this.render();
        //> We deep link to the editor tab using the URL hash,
        //  so save the new mode state to the hash.
        window.history.replaceState(null, document.title, '#' + mode);
        gevent('editor', 'switchmode', mode);
    }

    //> `liveRenderFrames()` is called when the editor content changes, to client-side
    //  refresh the iframe preview contents.
    liveRenderFrames() {
        if (!this.settings.asYouTypeEnabled) {
            return;
        }

        const documentMarkup = `<!DOCTYPE html>
<html>
    <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <link rel="icon" type="image/png" href="/static/assets/favicon-32x32.png" sizes="32x32" />
        <title>Live Frame | Pigeonpad</title>
    </head>
    <body>
        ${this.core.getValue('html')}
        <script src="https://unpkg.com/torus-dom/dist/index.min.js"></script>
        <script>${this.core.getValue('javascript')}</script>
    </body>
</html>`;

        this.record.update({
            liveRenderMarkup: documentMarkup,
        });
    }

    toggleSettings() {
        this.settings.visible = !this.settings.visible;
        this.render();
        //> The settings bar changes the editor view size, so we need to
        //  re-layout the editor after render.
        this.resizeEditor();
    }

    toggleAsYouType() {
        this.settings.asYouTypeEnabled = !this.settings.asYouTypeEnabled;
        this.render();
        //> In case there are any current dirty changes when this is toggled on...
        if (this.settings.asYouTypeEnabled) {
            this.liveRenderFramesImmediate();
        }
        gevent('editor', 'settings.asyoutype', this.settings.asYouTypeEnabled.toString());
    }

    //> `saveFrames` handles saving / persisting Pigeonpad files to the backend service,
    //  and returns a promise that resolves only once all frame files have been saved.
    async saveFrames() {
        const hashes = {
            html: '',
            js: '',
        }
        //> This is a nice way to make the function hang (not resolve its returned Promise)
        //  until all of its requests have resolved.
        await Promise.all([
            api.post('/frame/', this.core.getValue('html'))
                .then(resp => resp.text())
                .then(hash => hashes.html = hash)
                .catch(e => api.errlog(e)),
            api.post('/frame/', this.core.getValue('javascript'))
                .then(resp => resp.text())
                .then(hash => hashes.js = hash)
                .catch(e => api.errlog(e)),
        ]);
        //> Once we've saved the current frames, open the new frames up in the preview pane
        //  by going to this route with the new frames.
        const route = `/h/${hashes.html}/j/${hashes.js}/edit`;
        if (window.location.pathname.startsWith(route)) {
            this.record.update({
                liveRenderMarkup: null,
            });
        } else {
            router.go(route);
        }
        gevent('editor', 'save');
    }

    styles() {
        return css`
        height: 100%;
        flex-grow: 1;
        flex-shrink: 1;
        overflow: hidden;
        border-left: 2px solid var(--cf-black);
        display: flex;
        flex-direction: column;
        @media (max-width: 750px) {
            /* Overriding inline style */
            width: 100% !important;
            height: 50%;
            border-left: 0;
            border-top: 2px solid var(--cf-black);
        }
        .topBar {
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
            padding: 0 3px;
            border-bottom: 4px dotted var(--cf-black);
            flex-shrink: 0;
            height: 52px;
            overflow-x: auto;
            .embedded & {
                background: var(--cf-background);
            }
        }
        .buttonGroup {
            display: flex;
            flex-direction: row;
            align-items: center;
        }
        .button {
            font-size: .75rem;
        }
        .editorContainer .button {
            border: 0;
            background: transparent;
            height: unset;
            width: unset;
            &::before,
            &::after {
                display: none;
            }
        }
        .editorContainer,
        .ready {
            width: 100%;
            /* dummy size, flex will resize
             * but CodeMirror needs a set size.
             * set to 0 to avoid flex oversize
             * issues on Android Chrome on focus */
            height: 0;
            flex-shrink: 1;
            flex-grow: 1;
        }
        .ready {
            display: flex;
            flex-direction: row;
            justify-content: center;
            align-items: center;
            color: #555;
            em {
                display: block;
            }
        }
        .CodeMirror {
            height: 100%;
            font-family: 'Menlo', 'Monaco', 'Courier', monospace;
            font-size: 12px;
            line-height: 1.5em;
            &-gutters {
                background: #fff;
                border-right: 0;
            }
            &-lines {
                padding-bottom: 60vh;
            }
            &-cursor {
                border-width: 2px;
            }
            &-linenumber {
                padding-right: 12px;
            }

            span.cm-comment {
                color: #888;
            }
            span.cm-keyword {
                color: #3436bb;
                font-weight: bold;
            }
            span.cm-def {
                color: #038c6e;
            }
            span.cm-string,
            span.cm-string-2 {
                color: #b31515;
            }
            span.cm-number {
                color: #ec6140;
            }
            span.cm-tag {
                color: #038c6e;
            }
            span.cm-attribute {
                color: #e40132;
            }
        }
        textarea.editorContainer {
            font-family: 'Menlo', 'Monaco', 'Courier', monospace;
            font-size: 12px;
            line-height: 16px;
            box-sizing: border-box;
            padding: 4px 8px;
            -webkit-overflow-scrolling: touch;
            padding-bottom: 60vh;
            &:focus {
                outline: none;
            }
        }
        `;
    }

    compose() {
        const mode = this.core.getMode();

        return jdom`<div class="editor" style="width:${this.paneWidth}%">
            <div class="topBar">
                <div class="buttonGroup">
                    <button
                        class="button ${mode === 'html' ? 'active' : ''} tab-html"
                        title="Switch to HTML editor"
                        onclick="${this.switchHTMLMode}">
                        HTML
                    </button>
                    <button
                        class="button ${mode === 'javascript' ? 'active' : ''} tab-js"
                        title="Switch to JavaScript editor"
                        onclick="${this.switchJSMode}">
                        JavaScript
                    </button>
                </div>
                <div class="buttonGroup">
                    <button class="button ${this.settings.visible ? 'active' : ''}" title="Show additional settings"
                        onclick="${this.toggleSettings}">...</button>
                    <button class="button" title="Save Pad and reload preview"
                        onclick="${this.saveFrames}">Save ${'&'} Remix</button>
                </div>
            </div>
            ${this.settings.visible ? (
                jdom`<div class="topBar">
                    <button class="button ${this.settings.asYouTypeEnabled ? 'active' : ''}"
                        title="Turn on or off live-reloading as you type"
                        onclick="${this.toggleAsYouType}">
                        Reload as you type
                        ${this.settings.asYouTypeEnabled ? '(on)' : '(off)'}
                    </button>
                </div>`
            ) : null}
            ${this.core.ready() ? this.core.getContainer() : (
                //> If the editor is not yet available (is still loading), show a placeholder
                //  bit of text.
                jdom`<div class="ready"><em>Getting your editor ready...</em></div>`
            )}
        </div>`;
    }

}

//> The `Workspace` component is the "Pigeonpad editor". That is to say,
//  this is the component that wraps everything into a neat, interactive page
//  and is the backbone of the Pigeonpad editing experience.
class Workspace extends StyledComponent {

    init(frameRecord) {
        //> The left/right panes are split 50/50 between its two panes.
        this.paneSplit = 50;
        this.preview = new PreviewPane(frameRecord);
        this.editor = new Editor(frameRecord);

        this.bind(frameRecord, data => this.render(data));

        //> `this.grabDragging` represents whether there is currently a
        //  drag-to-resize-panes interaction happening.
        this.grabDragging = false;
        this.handleGrabMousedown = this.handleGrabMousedown.bind(this);
        this.handleGrabMousemove = this.handleGrabMousemove.bind(this);
        this.handleGrabMouseup = this.handleGrabMouseup.bind(this);

        window.addEventListener('beforeunload', evt => {
            if (this.record.get('liveRenderMarkup') !== null) {
                evt.returnValue = 'You have unsaved changes to your Pigeonpad. Are you sure you want to leave?';
            }
        });
    }

    //> Shortcut method to set the sizes of children components, given
    //  one split percentage.
    setPaneWidth(width) {
        //> These cases implement "snapping" of panes to 0, 50, 100%
        //  increments, with 1% buffer around each snap point.
        if (width < 1) {
            width = 0;
        } else if (width > 99) {
            width = 100;
        } else if (width > 49 && width < 51) {
            width = 50;
        }

        this.paneSplit = width;
        this.preview.setWidth(width);
        this.editor.setWidth(100 - width);
        this.render();
    }

    //> What follows are mouse/pointer event handlers to make resizing a
    //  smooth experience.

    handleGrabMousedown() {
        this.grabDragging = true;
        this.render();
    }

    handleGrabMousemove(evt) {
        if (this.grabDragging) {
            if (!evt.defaultPrevented) {
                evt.preventDefault();
            }
            //> If the event is a touch event, get the `clientX` of the first
            //  touch point, not the whole event.
            if (evt.touches) {
                evt = evt.touches[0];
            }
            this.setPaneWidth(evt.clientX / window.innerWidth * 100);
        }
    }

    handleGrabMouseup() {
        this.grabDragging = false;
        this.render();
        gevent('workspace', 'resize', 'editor', this.paneSplit);
    }

    styles() {
        return css`
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        header {
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
            padding: 4px;
            background: var(--cf-background);
            border-bottom: 4px solid var(--cf-black);
        }
        &.embedded header {
            display: none;
        }
        nav {
            display: flex;
            flex-direction: row;
            flex-shrink: 1;
            overflow-x: auto;
        }
        main {
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: flex-start;
            flex-grow: 1;
            flex-shrink: 1;
            overflow: hidden;
            position: relative;
            height: 100%;
            @media (max-width: 750px) {
                flex-direction: column;
            }
        }
        .button {
            white-space: nowrap;
        }
        .newButton {
            color: var(--cf-accent);
        }
        .grabHandle {
            position: absolute;
            top: 50%;
            left: 0;
            transform: translate(-50%, -50%);
            border-radius: 4px;
            width: 8px;
            height: 56px;
            background: #fff;
            border: 3px solid var(--cf-black);
            cursor: ew-resize;
            z-index: 2000;
            &:hover {
                background: var(--cf-background);
            }
            &:active {
                background: var(--cf-accent);
            }
        }
        .grabHandleShadow {
            background: rgba(0, 0, 0, .1);
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 1000;
            transition: opacity .3s;
            cursor: ew-resize;
            &.hidden {
                opacity: 0;
                pointer-events: none;
            }
        }
        .fullButton {
            display: none;
        }
        &.embedded .fullButton {
            display: block;
            position: absolute;
            top: unset;
            left: unset;
            bottom: 2px;
            right: 6px;
            font-size: .75em;
            z-index: 100;
        }
        `;
    }

    compose() {
        return jdom`
        <div class="workspace ${window.frameElement === null ? '' : 'embedded'}"
            ontouchmove="${this.grabDragging ? this.handleGrabMousemove : ''}"
            ontouchend="${this.grabDragging ? this.handleGrabMouseup : ''}"
            onmousemove="${this.grabDragging ? this.handleGrabMousemove : ''}"
            onmouseup="${this.grabDragging ? this.handleGrabMouseup : ''}">
            <header>
                <div class="logo">
                    <a class="button" href="/">Pigeonpad</a>
                </div>
                <nav>
                    <a class="button newButton" href="/new?from=editor">
                        + New <span class="mobile-hidden">Pigeonpad</span>
                    </a>
                    <a class="button tiny-hidden" href="https://pigeonaut.io/" target="_blank">
                        Find inspiration
                    </a>
                    <a class="button" href="mailto:hey@pigeonaut.io" target="_blank">
                        Get support
                    </a>
                </nav>
            </header>
            <main>
                ${this.preview.node}
                ${this.editor.node}
                <a class="button fullButton"
                    title="Open this editor in a new tab"
                    target="_blank"
                    href="${window.location.href}">
                    Open in new tab
                </a>
                <div class="grabHandleShadow ${this.grabDragging ? '' : 'hidden'}"></div>
                <div
                    title="Resize editor panes"
                    class="grabHandle mobile-hidden"
                    style="left:${this.paneSplit}%"
                    ontouchstart="${this.handleGrabMousedown}"
                    onmousedown="${this.handleGrabMousedown}">
                </div>
            </main>
        </div>`;
    }

}

//> The `App` component simply wraps around the `Workspace` to provide
// routing and a container for the workspace.
class App extends StyledComponent {

    init(router) {
        //> This `frameRecord` becomes the view model for most views
        //  in the editor.
        this.frameRecord = new Record({
            htmlFrameHash: '',
            jsFrameHash: '',
            liveRenderMarkup: null,
        });
        this.workspace = new Workspace(this.frameRecord);

        //> Routing logic.
        this.bind(router, ([name, params]) => {
            switch (name) {
                case 'edit':
                    this.frameRecord.update({
                        htmlFrameHash: params.htmlFrameHash,
                        jsFrameHash: params.jsFrameHash,
                        liveRenderMarkup: null,
                    });
                    break;
                case 'welcome':
                    //> This is a predetermined URL that points to the welcome Pigeonpad.
                    router.go('/f/d6d40c3cd33b/e3b0c44298fc.html/edit', { replace: true });
                    break;
                default:
                    {
                        //> If there are prefilled HTML and JavaScript values
                        //  provided in the query string, parse and save it for later
                        //  when the editor loads.
                        const searchPart = window.location.search.substr(1);
                        if (searchPart) {
                            for (const pair of searchPart.split('&')) {
                                const idx = pair.indexOf('=');
                                const langPart = pair.substr(0, idx);
                                if (langPart in loadedURLState) {
                                    loadedURLState[langPart] = decodeURIComponent(pair.substr(idx + 1));
                                }
                            }
                        }
                    }
                    //> When we redirect some URL right on page load, we want that new URL
                    //  to _replace_ the old, given URL value, not append a new history entry.
                    //  So replace the history entry, not append. In this case, we redirect to
                    //  the URL of an empty Pigeonpad
                    router.go(`/h/e3b0c44298fc/j/e3b0c44298fc/edit`, { replace: true });
                    break;
            }
        })
    }

    styles() {
        return css`
        width: 100%;
        height: 100vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        `;
    }

    compose() {
        return jdom`<div id="root">
            ${this.workspace.node}
        </div>`;
    }

}

//> Used to save some global values for when the URL contains a
//  pre-populated code sample or tab state saved in the hash.
const loadedURLState = {
    html: '',
    js: '',
    tab: window.location.hash.substr(1),
}

const router = new Router({
    edit: '/h/:htmlFrameHash/j/:jsFrameHash/edit',
    welcome: '/welcome',
    default: '/new',
});

//> Create a new instance of the editor app and mount it to the DOM.
const app = new App(router);
document.body.appendChild(app.node);

//> Since the editor is a full-window app, we don't want any overflows to
//  make the app unnecessary scrollable beyond its viewport.
document.body.style.overflow = 'hidden';
