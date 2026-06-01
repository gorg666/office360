import { useEffect } from "react";
import { translateText } from "@/i18n";
import { useUIStore } from "@/stores/uiStore";

const ATTRIBUTES_TO_TRANSLATE = ["title", "placeholder", "aria-label", "alt"] as const;
const SKIP_TEXT_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA"]);

function shouldSkipTextNode(node: Text) {
  const parent = node.parentElement;
  if (!parent) return true;
  if (SKIP_TEXT_TAGS.has(parent.tagName)) return true;
  if (parent.closest("[contenteditable='true'], [data-no-translate], iframe")) return true;
  return false;
}

function translateElementAttributes(element: Element, locale: "en" | "ru") {
  for (const attr of ATTRIBUTES_TO_TRANSLATE) {
    const value = element.getAttribute(attr);
    if (!value) continue;
    const translated = translateText(value, locale);
    if (translated !== value) element.setAttribute(attr, translated);
  }
}

function translateNodeTree(root: ParentNode, locale: "en" | "ru") {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!shouldSkipTextNode(node)) nodes.push(node);
  }

  for (const node of nodes) {
    const translated = translateText(node.nodeValue ?? "", locale);
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }

  if (root instanceof Element) {
    translateElementAttributes(root, locale);
  }
  if ("querySelectorAll" in root) {
    root.querySelectorAll("*").forEach((element) => translateElementAttributes(element, locale));
  }
}

export function TranslationLayer() {
  const locale = useUIStore((state) => state.locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === "ru" ? "Офис360" : "Office360";
    translateNodeTree(document.body, locale);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const text = mutation.target;
          if (text instanceof Text && !shouldSkipTextNode(text)) {
            const translated = translateText(text.nodeValue ?? "", locale);
            if (translated !== text.nodeValue) text.nodeValue = translated;
          }
          continue;
        }

        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          translateElementAttributes(mutation.target, locale);
          continue;
        }

        mutation.addedNodes.forEach((node) => {
          if (node instanceof Text) {
            if (shouldSkipTextNode(node)) return;
            const translated = translateText(node.nodeValue ?? "", locale);
            if (translated !== node.nodeValue) node.nodeValue = translated;
            return;
          }
          if (node instanceof Element) translateNodeTree(node, locale);
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES_TO_TRANSLATE],
    });

    return () => observer.disconnect();
  }, [locale]);

  return null;
}
