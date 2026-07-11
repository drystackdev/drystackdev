declare module 'idiomorph' {
  export interface IdiomorphCallbacks {
    beforeNodeAdded?(node: Node): boolean | void;
    afterNodeAdded?(node: Node): void;
    beforeNodeMorphed?(oldNode: Node, newNode: Node): boolean | void;
    afterNodeMorphed?(oldNode: Node, newNode: Node): void;
    beforeNodeRemoved?(node: Node): boolean | void;
    afterNodeRemoved?(node: Node): void;
  }

  export interface IdiomorphOptions {
    morphStyle?: 'outerHTML' | 'innerHTML';
    ignoreActive?: boolean;
    ignoreActiveValue?: boolean;
    callbacks?: IdiomorphCallbacks;
  }

  export const Idiomorph: {
    morph(
      oldNode: Element | Document,
      newContent: string | Node | NodeListOf<ChildNode>,
      options?: IdiomorphOptions
    ): void;
  };
}
