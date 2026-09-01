/* ═══════════════════════════════════════════
   BarberClub — Reelisations : visionneuse + barre de reservation
   Charge par toutes les pages pages/barbers/barber-*.html

   Trois choses :
   1. La visionneuse plein ecran. Au salon, un client montre une photo et dit
      « je veux ca » — la galerie doit permettre le meme geste, donc chaque
      realisation s'ouvre en grand et le seul bouton visible reserve avec ce
      barbier-la.
   2. Une barre de reservation qui suit sur mobile. Le CTA vivait tout en haut :
      apres trois coupes de scroll, plus rien pour reserver.
   3. Les videos de la galerie ne tournent que si elles sont a l'ecran. Lucas en
      a trois qui demarraient toutes ensemble au chargement.
   ═══════════════════════════════════════════ */
(function () {
    'use strict';

    var gallery = document.querySelector('.gallery');
    if (!gallery) return;

    var items = Array.prototype.slice.call(gallery.querySelectorAll('.gallery-item'));
    if (!items.length) return;

    var ctaLink = document.querySelector('.cta-btn');
    var bookingHref = ctaLink ? ctaLink.getAttribute('href') : null;
    var barberName = (document.querySelector('.profile-name') || {}).textContent || '';
    barberName = barberName.trim();

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ─── Le compte des realisations, dans le titre de section ─── */
    var sectionTitle = document.querySelector('.section-title');
    if (sectionTitle && !sectionTitle.querySelector('.section-count')) {
        var count = document.createElement('span');
        count.className = 'section-count';
        count.textContent = items.length;
        sectionTitle.appendChild(count);
    }

    /* ─── Chaque realisation devient cliquable au clavier comme au doigt ─── */
    items.forEach(function (item, i) {
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', 'Agrandir la realisation ' + (i + 1) + ' sur ' + items.length);
        item.classList.add('is-openable');

        item.addEventListener('click', function () { open(i); });
        item.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open(i);
            }
        });
    });

    /* ─── Les videos ne tournent qu'a l'ecran ─── */
    var vids = gallery.querySelectorAll('video');
    if (vids.length) {
        Array.prototype.forEach.call(vids, function (v) {
            v.setAttribute('preload', 'none');
            v.pause();
        });
        if ('IntersectionObserver' in window) {
            var vidObs = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    var v = entry.target;
                    if (entry.isIntersecting) {
                        if (v.preload === 'none') v.preload = 'auto';
                        var p = v.play();
                        if (p && p.catch) p.catch(function () {});
                    } else {
                        v.pause();
                    }
                });
            }, { rootMargin: '100px' });
            Array.prototype.forEach.call(vids, function (v) { vidObs.observe(v); });
        } else {
            Array.prototype.forEach.call(vids, function (v) { v.play().catch(function () {}); });
        }
    }

    /* ═══ La visionneuse ═══ */
    var viewer = document.createElement('div');
    viewer.className = 'viewer';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', 'Realisations de ' + (barberName || 'ce barbier'));  // attribut, pas du HTML
    viewer.hidden = true;
    viewer.innerHTML =
        '<div class="viewer-rail" aria-hidden="true"></div>' +
        '<button type="button" class="viewer-close" aria-label="Fermer">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<button type="button" class="viewer-nav viewer-prev" aria-label="Realisation precedente">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18 9 12l6-6"/></svg>' +
        '</button>' +
        '<button type="button" class="viewer-nav viewer-next" aria-label="Realisation suivante">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>' +
        '</button>' +
        '<div class="viewer-stage"></div>' +
        '<div class="viewer-bar">' +
            '<span class="viewer-count" aria-live="polite"></span>' +
        '</div>';
    document.body.appendChild(viewer);

    // Le lien de reservation est monte via le DOM, jamais concatene dans du HTML
    if (bookingHref) {
        var book = document.createElement('a');
        book.className = 'viewer-book';
        book.href = bookingHref;
        book.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
        var bookLabel = document.createElement('span');
        bookLabel.textContent = 'Je veux cette coupe';
        book.appendChild(bookLabel);
        viewer.querySelector('.viewer-bar').appendChild(book);
    }

    var stage = viewer.querySelector('.viewer-stage');
    var rail = viewer.querySelector('.viewer-rail');
    var counter = viewer.querySelector('.viewer-count');
    var index = 0;
    var lastFocus = null;

    viewer.querySelector('.viewer-close').addEventListener('click', close);
    viewer.querySelector('.viewer-prev').addEventListener('click', function () { go(-1); });
    viewer.querySelector('.viewer-next').addEventListener('click', function () { go(1); });
    viewer.addEventListener('click', function (e) {
        if (e.target === viewer || e.target === stage) close();
    });

    function render() {
        var source = items[index].querySelector('img, video');
        stage.innerHTML = '';
        if (!source) return;

        var media;
        if (source.tagName === 'VIDEO') {
            media = document.createElement('video');
            media.src = source.currentSrc || (source.querySelector('source') || {}).src || '';
            media.autoplay = true;
            media.loop = true;
            media.muted = true;
            media.playsInline = true;
            media.setAttribute('playsinline', '');
        } else {
            media = document.createElement('img');
            media.src = source.currentSrc || source.src;
            media.alt = source.alt || '';
            media.decoding = 'async';
        }
        media.className = 'viewer-media';
        if (!reduceMotion) media.classList.add('is-entering');
        stage.appendChild(media);
        if (!reduceMotion) {
            requestAnimationFrame(function () { media.classList.remove('is-entering'); });
        }

        counter.textContent = (index + 1) + ' / ' + items.length;
        rail.style.setProperty('--progress', ((index + 1) / items.length * 100) + '%');
        viewer.querySelector('.viewer-prev').disabled = false;
        viewer.querySelector('.viewer-next').disabled = false;
    }

    function go(step) {
        index = (index + step + items.length) % items.length;
        render();
    }

    function open(i) {
        index = i;
        lastFocus = document.activeElement;
        viewer.hidden = false;
        document.documentElement.classList.add('viewer-open');
        render();
        requestAnimationFrame(function () { viewer.classList.add('is-open'); });
        viewer.querySelector('.viewer-close').focus();
        document.addEventListener('keydown', onKey);
    }

    function close() {
        viewer.classList.remove('is-open');
        document.removeEventListener('keydown', onKey);
        document.documentElement.classList.remove('viewer-open');
        var done = function () {
            viewer.hidden = true;
            stage.innerHTML = '';
        };
        if (reduceMotion) done();
        else setTimeout(done, 220);
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    function onKey(e) {
        if (e.key === 'Escape') { close(); return; }
        if (e.key === 'ArrowLeft') { go(-1); return; }
        if (e.key === 'ArrowRight') { go(1); return; }
        if (e.key === 'Tab') {
            // Le focus reste dans la visionneuse tant qu'elle est ouverte
            var focusables = viewer.querySelectorAll('button:not([disabled]), a[href]');
            if (!focusables.length) return;
            var first = focusables[0];
            var last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    /* Balayage horizontal — le geste attendu sur un telephone */
    var touchX = null, touchY = null;
    stage.addEventListener('touchstart', function (e) {
        touchX = e.changedTouches[0].clientX;
        touchY = e.changedTouches[0].clientY;
    }, { passive: true });
    stage.addEventListener('touchend', function (e) {
        if (touchX === null) return;
        var dx = e.changedTouches[0].clientX - touchX;
        var dy = e.changedTouches[0].clientY - touchY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
        else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
        touchX = touchY = null;
    }, { passive: true });

    /* ═══ Barre de reservation collante (mobile) ═══ */
    if (ctaLink && bookingHref) {
        var bar = document.createElement('div');
        bar.className = 'book-bar';
        var barBtn = document.createElement('a');
        barBtn.className = 'book-bar-btn';
        barBtn.href = bookingHref;
        barBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
        var barLabel = document.createElement('span');
        barLabel.textContent = 'Prendre RDV' + (barberName ? ' avec ' + barberName : '');
        barBtn.appendChild(barLabel);
        bar.appendChild(barBtn);
        document.body.appendChild(bar);

        if ('IntersectionObserver' in window) {
            // La barre n'apparait qu'une fois le bouton d'origine passe : deux
            // fois le meme bouton a l'ecran, ca fait doublon.
            var barObs = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    bar.classList.toggle('is-visible', !entry.isIntersecting && entry.boundingClientRect.top < 0);
                });
            }, { threshold: 0 });
            barObs.observe(ctaLink);
        } else {
            bar.classList.add('is-visible');
        }
    }
})();
