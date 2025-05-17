import { App, Modal, Setting } from 'obsidian';

export class AuthCodeModal extends Modal {
    private code: string = '';
    private onSubmit: (code: string) => void;

    constructor(app: App, onSubmit: (code: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Enter Authorization Code' });
        contentEl.createEl('p', { text: 'Please paste the authorization code from the URL here. You can find it in the URL after "code=".' });

        new Setting(contentEl)
            .setName('Authorization Code')
            .addText((text) => {
                text.onChange((value) => {
                    this.code = value;
                });
                text.inputEl.focus();
            });

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText('Submit')
                    .setCta()
                    .onClick(() => {
                        if (this.code) {
                            this.onSubmit(this.code);
                            this.close();
                        }
                    }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
