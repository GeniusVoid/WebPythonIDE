// --- IMPORT LIBRARIES ---
import {EditorView, basicSetup} from "https://esm.sh/codemirror@6.0.1";
import {python} from "https://esm.sh/@codemirror/lang-python@6.1.3";
import {oneDark} from "https://esm.sh/@codemirror/theme-one-dark@6.1.2";
import {keymap} from "https://esm.sh/@codemirror/view@6.0.1";
import {indentWithTab} from "https://esm.sh/@codemirror/commands@6.0.1";
import {autocompletion, snippetCompletion} from "https://esm.sh/@codemirror/autocomplete@6.0.1";

// --- 1. SNIPPETS & SCANNER ---
const pythonSnippets = [
    snippetCompletion("def ${name}(${args}):\n\t${pass}", {label: "def", detail: "function", type: "keyword"}),
    snippetCompletion("for ${i} in range(${10}):\n\t${pass}", {label: "for", detail: "loop", type: "keyword"}),
    snippetCompletion("if ${condition}:\n\t${pass}", {label: "if", detail: "block", type: "keyword"}),
    snippetCompletion("import ${module}", {label: "import", detail: "module", type: "keyword"}),
    snippetCompletion("print(${obj})", {label: "print", detail: "console", type: "function"}),
];

function localScanner(context) {
    let word = context.matchBefore(/\w*/);
    if (!word || (word.from == word.to && !context.explicit)) return null;
    let text = context.state.doc.toString();
    let matches = [...text.matchAll(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g)];
    let unique = [...new Set(matches.map(m => m[0]))].map(l => ({ label: l, type: "variable" }));
    return { from: word.from, options: unique };
}

// --- 2. FILE SYSTEM ---
const defaultFiles = {
    'main.py': '# Master Python IDE\n\n# 1. Type "print"\n# 2. Type "def"\n# 3. Hit Run\n\nprint("Ready to code.")',
};
let files = JSON.parse(localStorage.getItem('myPyFilesMaster')) || defaultFiles;
let currentFile = 'main.py';

// --- 3. APP LOGIC ---
const app = {
    editor: null,
    pyodide: null,

    init: function() {
        this.initEditor();
        this.renderFileList();
        this.initPython();
        setInterval(() => this.save(), 1500);
    },

    save: function() {
        if (this.editor) {
            files[currentFile] = this.editor.state.doc.toString();
            localStorage.setItem('myPyFilesMaster', JSON.stringify(files));
        }
    },

    initEditor: function() {
        document.getElementById('editor-container').innerHTML = '';
        this.editor = new EditorView({
            doc: files[currentFile],
            extensions: [
                basicSetup, keymap.of([indentWithTab]), python(), oneDark,
                autocompletion({override: [localScanner, autocompletion().extension]}),
                python().language.data.of({ autocomplete: pythonSnippets }),
                EditorView.lineWrapping
            ],
            parent: document.getElementById('editor-container')
        });
    },

    setEditorContent: function(content) {
        this.editor.dispatch({
            changes: {from: 0, to: this.editor.state.doc.length, insert: content}
        });
    },

    // --- NEW: EXPORT & IMPORT ---
    
    // 1. Download Current File (.py)
    downloadCurrentFile: function() {
        this.save();
        const content = files[currentFile];
        const blob = new Blob([content], {type: "text/plain"});
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = currentFile; // e.g. "main.py"
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.log(`>> Downloaded ${currentFile}`, false, true);
    },

    // 2. Download Project Backup (.json)
    downloadProject: function() {
        this.save();
        const blob = new Blob([JSON.stringify(files, null, 2)], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "python_project_backup.json";
        a.click();
        URL.revokeObjectURL(url);
    },

    // 3. Import File
    importFile: function(input) {
        const file = input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            // Add to files list
            if (files[file.name]) {
                if(!confirm(`Overwrite ${file.name}?`)) return;
            }
            files[file.name] = content;
            this.save();
            this.loadFile(file.name); // Switch to new file
            this.log(`>> Imported ${file.name}`, false, true);
        };
        reader.readAsText(file);
        input.value = ''; // Reset input
    },

    // --- EXECUTION ---
    runCode: async function() {
        this.save();
        this.switchView('terminal');
        
        if (!this.pyodide) { this.log(">> Loading Engine...", true); return; }

        this.log(">> Syncing Files...", false, true);
        // Write virtual files
        Object.keys(files).forEach(name => {
            this.pyodide.FS.writeFile(name, files[name]);
        });

        this.log(`>> Running ${currentFile}...`, false, true);
        
        setTimeout(async () => {
            try {
                await this.pyodide.runPythonAsync("import sys"); // Reset sys
                await this.pyodide.runPythonAsync(files[currentFile]);
            } catch (err) {
                this.log(err, true);
            }
        }, 50);
    },

    // --- UTILS ---
    createNewFile: function() {
        const name = prompt("File Name (e.g. data.py):");
        if (name) {
            files[name] = "# New File";
            this.save();
            this.loadFile(name);
        }
    },

    loadFile: function(name) {
        this.save();
        currentFile = name;
        this.setEditorContent(files[name]);
        this.renderFileList();
        this.toggleSidebar();
    },

    deleteFile: function(name) {
        if(confirm(`Delete ${name}?`)) {
            delete files[name];
            this.save();
            if(currentFile === name) this.loadFile(Object.keys(files)[0]);
            else this.renderFileList();
        }
    },

    renderFileList: function() {
        const list = document.getElementById('file-list');
        list.innerHTML = '';
        Object.keys(files).forEach(name => {
            const div = document.createElement('div');
            div.className = `file-item ${name === currentFile ? 'active' : ''}`;
            div.innerHTML = `<span onclick="app.loadFile('${name}')">${name}</span>`;
            if (name !== 'main.py') {
                div.innerHTML += `<span class="delete-file" onclick="app.deleteFile('${name}')">&times;</span>`;
            }
            list.appendChild(div);
        });
        document.getElementById('current-file-name').innerText = currentFile;
    },

    toggleSidebar: function() { document.getElementById('sidebar').classList.toggle('open'); },
    
    switchView: function(view) {
        document.querySelectorAll('.view, .tab').forEach(el => el.classList.remove('active'));
        if (view === 'editor') {
            document.getElementById('editor-view').classList.add('active');
            document.getElementById('tab-editor').classList.add('active');
            document.getElementById('accessory-bar').classList.remove('hidden');
        } else {
            document.getElementById('console-view').classList.add('active');
            document.getElementById('tab-terminal').classList.add('active');
            document.getElementById('accessory-bar').classList.add('hidden');
        }
    },

    insert: function(text) {
        this.editor.dispatch(this.editor.state.replaceSelection(text));
        this.editor.focus();
    },

    log: function(text, isError = false, isSystem = false) {
        const consoleDiv = document.getElementById('console-view');
        const line = document.createElement('div');
        line.textContent = text;
        line.className = `output-line ${isError ? 'error-line' : ''} ${isSystem ? 'system-msg' : ''}`;
        consoleDiv.appendChild(line);
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    },

    initPython: async function() {
        try {
            this.pyodide = await loadPyodide({
                stdout: (t) => this.log(t),
                stderr: (t) => this.log(t, true)
            });
            this.log(">> Python 3.11 Ready.", false, true);
        } catch (e) { this.log("Error: " + e, true); }
    }
};

window.app = app;
app.init();

