import { DocumentFormattingEditProvider, Disposable, FormattingOptions, TextDocument, CancellationToken, ProviderResult, TextEdit, Position, Range, OutputChannel } from 'vscode';
import * as cp from 'child_process';

const EXIT_STRING = String.fromCharCode(4);
const EOF_STRING = String.fromCharCode(0);

class FormatResults {
    resolve: (t) => void;
    text: string;
};

export class SuperColliderFormatter implements DocumentFormattingEditProvider, Disposable {
    output: OutputChannel;
    formatterPath: string;
    formatterProcess: cp.ChildProcess;
    tabSize: Number;
    useSpaces: Boolean;
    listeners: FormatResults[] = [];

    constructor(output: OutputChannel, formatterPath: string, tabSize: Number, useSpaces: Boolean) {
        this.output = output;
        this.formatterPath = formatterPath;
        this.tabSize = tabSize;
        this.useSpaces = useSpaces;

        this.start();
    }

    restart() {
        this.end();
        this.start();
    }

    start() {
        if (!this.formatterProcess) {
            let args = ['-i', this.tabSize.toString(), '-w'];
            if (!this.useSpaces) {
                args = [...args, '-t']
            }

            this.formatterProcess = cp.spawn(this.formatterPath, args, {
                stdio: 'pipe'
            });
            this.formatterProcess.stdout.on('data', (stream) => {
                this.onData(stream);
            })
        }
    }

    end() {
        if (this.formatterProcess) {
            if (this.formatterProcess.connected) {
                this.formatterProcess.stdin.write(EXIT_STRING);
                this.formatterProcess.stdin.end();
            }
            this.formatterProcess.kill();
            this.formatterProcess.disconnect()
            this.formatterProcess = null;
            this.listeners = [];
        }
    }

    provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]> {
        const text = document.getText();

        if (this.formatterProcess) {
            let promise = new Promise<string>((resolve) => {
                this.listeners.push({ resolve: resolve, text: "" });
                this.formatterProcess.stdin.cork();
                this.formatterProcess.stdin.write(text);
                this.formatterProcess.stdin.write(EOF_STRING);
                this.formatterProcess.stdin.uncork();
            });

            return new Promise<TextEdit[]>(async (resolve) => {
                let formatted = await promise;
                resolve(
                    [new TextEdit(new Range(
                        new Position(0, 0),
                        new Position(999999, 999999)
                    ), formatted)]
                )
            });
        }
    }

    onData(stream) {
        if (this.listeners.length == 0) {
            this.output.appendLine("ERROR: Received data from formatter, but we weren't waiting on anything.")
        }

        let chunks = stream.toString().split(EOF_STRING);

        while (chunks.length > 1) {
            let listener = this.listeners[0];
            this.listeners = this.listeners.slice(1);

            listener.text += chunks[0]
            listener.resolve(listener.text);
        }

        this.listeners[0].text += stream;
    }

    dispose() { }
}
