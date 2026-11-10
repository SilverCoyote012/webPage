// Pequeñas ayudas del panel: confirmaciones y vista previa de la foto.
(function () {
  'use strict';
  document.addEventListener('submit', function (event) {
    var message = event.target.getAttribute('data-confirm');
    if (message && !window.confirm(message)) event.preventDefault();
  });

  var input = document.querySelector('[data-preview-input]');
  var preview = document.querySelector('[data-preview]');
  if (input && preview) {
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (file) preview.src = URL.createObjectURL(file);
    });
  }
})();
