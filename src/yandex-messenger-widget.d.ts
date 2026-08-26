declare module "yandex-messenger-widget" {
  interface WidgetOptions {
    serviceId: number;
    authToken?: string;
  }

  interface BlockUI {
    mount(node: HTMLElement): void;
  }

  interface Widget {
    setUI(ui: BlockUI): Widget;
    init(): Widget;
    show(): void;
    hide(): void;
  }

  export function blockUIFactory(): BlockUI;
  export function createMultiChatsWidget(options: WidgetOptions): Widget;
}
