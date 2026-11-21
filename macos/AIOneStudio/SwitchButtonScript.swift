import WebKit

/// The ⇄ button (bottom right, same look as the Windows app). Links to aos-native://connect, which the navigation delegate intercepts.
enum SwitchButtonScript {
    static let source = #"""
    (function(){try{
      if(document.getElementById("aos-switch"))return;
      var b=document.createElement("a");b.id="aos-switch";b.href="aos-native://connect";
      b.title="Connection settings (⌘⇧K)";b.textContent="⇄";
      b.style.cssText="position:fixed;right:8px;bottom:8px;z-index:2147483647;width:24px;height:24px;line-height:24px;text-align:center;border-radius:12px;background:#7612DA;color:#fff;font:14px system-ui,sans-serif;text-decoration:none;opacity:.35;cursor:pointer";
      b.onmouseenter=function(){b.style.opacity="1"};b.onmouseleave=function(){b.style.opacity=".35"};
      (document.body||document.documentElement).appendChild(b);
    }catch(e){}})();
    """#
    static func make() -> WKUserScript { WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true) }
}
