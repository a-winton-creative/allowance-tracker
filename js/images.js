/* Photos: getting them ready to upload, and showing them quickly.
 *
 * Uploading: still photos (JPG, PNG, iPhone HEIC…) are redrawn on a canvas and
 * saved as a smaller JPG before they're sent, so uploads are quick on
 * cellular. GIFs are sent exactly as they are, so they keep their animation.
 *
 * Showing: an image is downloaded from the back end once, then kept in this
 * browser's cache, so it appears instantly next time, even offline.
 */
(function () {
  var MAX_BYTES = 5 * 1024 * 1024;
  var CACHE = 'allowance-images-v1';
  var mem = {};        // id -> object URL (this visit)
  var inflight = {};   // id -> promise

  // ---------------------------------------------------------------- helpers

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1]); };
      r.onerror = function () { reject(new Error('Couldn’t read that file.')); };
      r.readAsDataURL(blob);
    });
  }
  function base64ToBlob(b64, mime) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  function canvasToJpeg(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('Couldn’t prepare that photo.')); }, 'image/jpeg', quality);
    });
  }

  /** Opens any photo the browser understands. Resolves to an <img> that's ready to draw. */
  function decode(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('This browser can’t open that kind of photo. Try a JPG, PNG or GIF.'));
      };
      img.src = url;
    });
  }
  function isGif(file) { return file.type === 'image/gif' || /\.gif$/i.test(file.name || ''); }

  // ---------------------------------------------------------------- upload prep

  /** A GIF goes up untouched (it must be 5 MB or less). */
  function prepareGif(file) {
    if (file.size > MAX_BYTES) return Promise.reject(new Error('That GIF is over 5 MB. Please pick a smaller one.'));
    return blobToBase64(file).then(function (data) { return { mime: 'image/gif', data: data, previewUrl: URL.createObjectURL(file) }; });
  }

  /** Background: shrink so the longest side is at most 1800 px, save as JPG. */
  function prepareBackground(file) {
    if (isGif(file)) return prepareGif(file);
    return decode(file).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight;
      var s = Math.min(1, 1800 / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * s); c.height = Math.round(h * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return canvasToJpeg(c, 0.82);
    }).then(function (blob) {
      return blobToBase64(blob).then(function (data) { return { mime: 'image/jpeg', data: data, previewUrl: URL.createObjectURL(blob) }; });
    });
  }

  /**
   * Avatar cropper: drag to move, slider to zoom, inside a circle.
   * `box` is an empty element; returns { done(): Promise<upload>, destroy() }.
   */
  function makeCropper(box, img, slider) {
    var V = box.clientWidth || 260;
    var w = img.naturalWidth, h = img.naturalHeight;
    var base = Math.max(V / w, V / h);   // smallest size that still fills the circle
    var zoom = 1, s = base, x = (V - w * s) / 2, y = (V - h * s) / 2;
    var view = img.cloneNode();
    view.alt = '';
    view.draggable = false;
    box.innerHTML = '';
    box.appendChild(view);

    function clamp() {
      x = Math.min(0, Math.max(V - w * s, x));
      y = Math.min(0, Math.max(V - h * s, y));
    }
    function paint() {
      clamp();
      view.style.width = (w * s) + 'px';
      view.style.height = (h * s) + 'px';
      view.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    }
    paint();

    var drag = null;
    box.addEventListener('pointerdown', function (e) {
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: x, y: y };
      box.setPointerCapture(e.pointerId);
      box.classList.add('dragging');
    });
    box.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      x = drag.x + (e.clientX - drag.sx);
      y = drag.y + (e.clientY - drag.sy);
      paint();
    });
    function end() { drag = null; box.classList.remove('dragging'); }
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);

    slider.addEventListener('input', function () {
      // zoom around the centre of the circle
      var cx = (V / 2 - x) / s, cy = (V / 2 - y) / s;
      zoom = Number(slider.value);
      s = base * zoom;
      x = V / 2 - cx * s; y = V / 2 - cy * s;
      paint();
    });

    return {
      done: function () {
        var out = 600;
        var c = document.createElement('canvas');
        c.width = out; c.height = out;
        c.getContext('2d').drawImage(img, -x / s, -y / s, V / s, V / s, 0, 0, out, out);
        return canvasToJpeg(c, 0.86).then(function (blob) {
          return blobToBase64(blob).then(function (data) { return { mime: 'image/jpeg', data: data, previewUrl: URL.createObjectURL(blob) }; });
        });
      }
    };
  }

  // ---------------------------------------------------------------- showing

  function cacheOpen() {
    try { return window.caches ? caches.open(CACHE).catch(function () { return null; }) : Promise.resolve(null); }
    catch (e) { return Promise.resolve(null); }
  }
  function key(id) { return new URL('img-cache/' + encodeURIComponent(id), location.href).href; }

  /** Resolves to an object URL for the image, from memory, this browser's cache, or the back end. */
  function load(id) {
    if (mem[id]) return Promise.resolve(mem[id]);
    if (inflight[id]) return inflight[id];
    inflight[id] = cacheOpen().then(function (cache) {
      var fromCache = cache ? cache.match(key(id)).catch(function () { return null; }) : Promise.resolve(null);
      return fromCache.then(function (res) {
        if (res) return res.blob();
        return Api.getImage(id).then(function (d) {
          var blob = base64ToBlob(d.data, d.mime);
          if (cache) cache.put(key(id), new Response(blob, { headers: { 'Content-Type': d.mime } })).catch(function () {});
          return blob;
        });
      });
    }).then(function (blob) {
      mem[id] = URL.createObjectURL(blob);
      delete inflight[id];
      return mem[id];
    }, function (err) { delete inflight[id]; throw err; });
    return inflight[id];
  }

  /** Remember a just-uploaded image so it shows instantly without downloading it again. */
  function remember(id, previewUrl) { if (id && previewUrl) mem[id] = previewUrl; }

  /** Fill in every image placeholder inside `root`. */
  function hydrate(root) {
    root.querySelectorAll('img[data-img-id]').forEach(function (el) {
      var id = el.getAttribute('data-img-id');
      if (mem[id]) { el.src = mem[id]; return; }
      load(id).then(function (u) { el.src = u; }).catch(function () { /* keep showing the initial */ });
    });
    root.querySelectorAll('[data-bg-id]').forEach(function (el) {
      var id = el.getAttribute('data-bg-id');
      var set = function (u) { el.style.backgroundImage = 'url("' + u + '")'; el.classList.add('is-loaded'); };
      if (mem[id]) { set(mem[id]); return; }
      load(id).then(set).catch(function () { /* theme colour shows instead */ });
    });
  }

  /** Forget cached images that are no longer used (keeps the cache small). */
  function prune(keepIds) {
    cacheOpen().then(function (cache) {
      if (!cache) return;
      cache.keys().then(function (reqs) {
        reqs.forEach(function (r) {
          var id = decodeURIComponent(r.url.split('img-cache/')[1] || '');
          if (keepIds.indexOf(id) < 0) cache.delete(r);
        });
      });
    });
  }

  window.Images = {
    isGif: isGif,
    decode: decode,
    prepareGif: prepareGif,
    prepareBackground: prepareBackground,
    makeCropper: makeCropper,
    peek: function (id) { return mem[id] || ''; },
    remember: remember,
    hydrate: hydrate,
    prune: prune
  };
})();
