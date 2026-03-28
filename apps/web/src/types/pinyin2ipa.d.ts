declare module "pinyin2ipa" {
  export interface Pinyin2IpaOptions {
    method?: "default" | "sophisticated" | string;
    toneMarker?: "number" | "chaonumber" | "chaoletter";
    markNeutral?: boolean;
    superscript?: boolean;
    filterUnknown?: boolean;
  }

  export default function pinyin2ipa(input: string, options?: Pinyin2IpaOptions): string;
}

declare module "pinyin2ipa/dist/pinyin2ipa.js" {
  export interface Pinyin2IpaOptions {
    method?: "default" | "sophisticated" | string;
    toneMarker?: "number" | "chaonumber" | "chaoletter";
    markNeutral?: boolean;
    superscript?: boolean;
    filterUnknown?: boolean;
  }

  export default function pinyin2ipa(input: string, options?: Pinyin2IpaOptions): string;
}
