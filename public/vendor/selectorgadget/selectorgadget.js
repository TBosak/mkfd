// SelectorGadget loader — vendored for Mkfd.
//
// Copyright (c) 2008, 2009 Andrew Cantino
// Copyright (c) 2008, 2009 Kyle Maxwell
//
// Two deliberate changes from the upstream CloudFront copy:
//
// 1. Every asset URL is local. Upstream pulled selectorgadget.css, dom.js,
//    diff_match_patch.js and interface.js from CloudFront and jQuery 1.3.1
//    from ajax.googleapis.com. Those are third-party network dependencies on
//    a document that must work on an air-gapped install, and pinning only the
//    entry file would have left five unpinned fetches behind it.
// 2. wait_for_script_load no longer uses eval(). Upstream evaluated
//    "typeof <name>" as a string, which a Content-Security-Policy without
//    'unsafe-eval' blocks outright. It now reads the global off the window
//    object, which is equivalent for the names it is called with.
//
// Vendored verbatim otherwise. See docs/mkfd-v3-implementation-ledger.md
// (CF-08) for the known-vulnerable jQuery 1.3.1 this chain still carries.

var SG_BASE = "/vendor/selectorgadget/";

function importJS(src, look_for, onload) {
  var s = document.createElement('script');
  s.setAttribute('type', 'text/javascript');
  s.setAttribute('src', src);
  if (onload) wait_for_script_load(look_for, onload);
  var head = document.getElementsByTagName('head')[0];
  if (head) {
    head.appendChild(s);
  } else {
    document.body.appendChild(s);
  }
}

function importCSS(href) {
  var s = document.createElement('link');
  s.setAttribute('rel', 'stylesheet');
  s.setAttribute('type', 'text/css');
  s.setAttribute('media', 'screen');
  s.setAttribute('href', href);
  var head = document.getElementsByTagName('head')[0];
  if (head) {
    head.appendChild(s);
  } else {
    document.body.appendChild(s);
  }
}

function wait_for_script_load(look_for, callback) {
  var interval = setInterval(function() {
    if (typeof window[look_for] !== 'undefined') {
      clearInterval(interval);
      callback();
    }
  }, 50);
}

(function(){
  importCSS(SG_BASE + 'selectorgadget.css');
  importJS(SG_BASE + 'jquery.min.js', 'jQuery', function() {
    jQuery.noConflict();
    importJS(SG_BASE + 'diff_match_patch.js', 'diff_match_patch', function() {
      importJS(SG_BASE + 'dom.js', 'DomPredictionHelper', function() {
        importJS(SG_BASE + 'interface.js');
      });
    });
  });
})();
