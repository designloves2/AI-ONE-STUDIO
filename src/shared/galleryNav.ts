// galleryNav.ts — where a "go to this tool" action from inside a gallery component lands.
//
// In the main app the galleries live inside each tool's page, so switching tool = a hash
// change. The standalone gallery page (gallery.html) is a separate document, so the same
// action has to jump to the generator app instead. That page calls setGalleryNavTarget()
// once; everything else keeps the default.
type NavFn = (toolHash: string) => void;

let navTarget: NavFn = (toolHash) => {
  location.hash = toolHash;
};

export function setGalleryNavTarget(fn: NavFn) {
  navTarget = fn;
}

export function navigateToTool(toolHash: string) {
  navTarget(toolHash);
}
