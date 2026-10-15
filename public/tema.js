// Applies the theme and sheet color before the app loads, so a dark theme
// does not flash white. Same keys as src/lib/settings.ts. A separate file
// because the CSP (public/_headers) does not allow inline scripts.
(function () {
  try {
    var root = document.documentElement;
    var tema = localStorage.getItem('lirismo:tema');
    var folha = localStorage.getItem('lirismo:folha');
    if (tema === 'meio' || tema === 'escuro') {
      root.setAttribute('data-tema', tema);
      document.querySelector('meta[name="theme-color"]').setAttribute('content', tema === 'meio' ? '#2F2C28' : '#161513');
    }
    if (folha === 'branca' || folha === 'amarelada' || folha === 'preta') root.setAttribute('data-folha', folha);
  } catch (e) {
    // Storage blocked: the light theme.
  }
})();
