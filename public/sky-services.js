/* APD sky imagery and name resolution. Existing catalogue data and drawing stay in skychart.html. */
(function (root) {
  function normalizeName(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  }

  function cataloguePosition(name, catalogue) {
    const target = normalizeName(name);
    const match = [...catalogue.dsos, ...catalogue.stars].find(item =>
      [item.id, item.name, item.desig, item.label, item.hip ? `HIP ${item.hip}` : '']
        .some(value => value && normalizeName(value) === target));
    return match && Number.isFinite(match.ra) && Number.isFinite(match.dec)
      ? { ra: match.ra, dec: match.dec, source: 'Bundled catalogue' } : null;
  }

  async function jsonResponse(response) {
    const text = await response.text();
    let value;
    try { value = JSON.parse(text); }
    catch { throw new Error(`APD HTTP ${response.status}: invalid service response`); }
    if (!response.ok) {
      const error = new Error(value.error || `APD HTTP ${response.status}`);
      error.attempts = value.attempts || [];
      throw error;
    }
    return value;
  }

  function create({ aladin, getCatalogue, onImagery, onSearch, fetchImpl = fetch }) {
    let selection = 0, surveyController, pollTimer, currentId;
    let searchController, searchVersion = 0;
    const originalGotoObject = aladin.gotoObject.bind(aladin);
    let registry;
    const read = (path, signal) => fetchImpl(path, { signal, cache: 'no-store' }).then(jsonResponse);
    const showSurvey = visible => {
      if (aladin.getBaseImageLayer()) aladin.showSurvey(visible);
    };
    const stopSurvey = () => {
      clearTimeout(pollTimer);
      surveyController?.abort();
    };
    const cancelSearch = () => {
      searchVersion++;
      if (searchController) {
        searchController.abort();
        searchController = undefined;
        onSearch({ state: 'cancelled' });
      }
    };

    async function selectSurvey(id) {
      stopSurvey();
      const version = ++selection;
      currentId = id;
      surveyController = new AbortController();
      const signal = surveyController.signal;
      showSurvey(false);
      onImagery({ state: 'loading', local: true, attempts: [] });
      try {
        if (!registry) registry = await read('/data/sky-surveys.json', signal);
        signal.throwIfAborted();
        const survey = registry.find(item => item.id === id);
        if (!survey) throw new Error('The selected sky survey is not registered');
        const base = `/api/skychart/surveys/${survey.key}`;
        await read(`${base}/metadata`, signal);
        if (version !== selection || signal.aborted) return;
        // Aladin 3.6.5 treats a relative URL as a registry ID. An absolute
        // same-origin root keeps its metadata and image requests on this proxy.
        const rootUrl = new URL(base, root.location.href).href;
        const layer = aladin.createImageSurvey(survey.id, survey.name, rootUrl, undefined, undefined, survey.renderOptions || {});
        aladin.setBaseImageLayer(layer);
        await layer.query;
        if (version !== selection || signal.aborted) return;
        showSurvey(true);
        const poll = async () => {
          try {
            const status = await read(`${base}/status`, signal);
            if (version !== selection || signal.aborted) return;
            if (status.state === 'unavailable') {
              showSurvey(false);
              onImagery({ ...status, local: true });
              return;
            }
            onImagery({ ...status, local: status.state !== 'ready' });
            pollTimer = setTimeout(poll, 1500);
          } catch (error) {
            if (version !== selection || signal.aborted) return;
            showSurvey(false);
            onImagery({ state: 'unavailable', local: true, error: error.message, attempts: error.attempts || [] });
          }
        };
        await poll();
      } catch (error) {
        if (version !== selection || signal.aborted) return;
        showSurvey(false);
        onImagery({ state: 'unavailable', local: true, error: error.message || String(error), attempts: error.attempts || [] });
      }
    }

    // Keep Aladin's public callback contract and its coordinate/frame parser.
    // Its built-in position field and APD's Search controls share this boundary.
    aladin.gotoObject = function (target, callbacks) {
      cancelSearch();
      const version = searchVersion;
      const options = typeof callbacks === 'function' ? { error: callbacks } : callbacks || {};
      onSearch({ state: 'loading', name: target });
      if (!/[a-zA-Z]/.test(target)) {
        return originalGotoObject(target, {
          success: position => { onSearch({ state: 'ready' }); options.success?.(position); },
          error: error => { onSearch({ state: 'error', error: 'Invalid sky coordinates' }); options.error?.(error); },
        });
      }
      searchController = new AbortController();
      const signal = searchController.signal;
      (async () => {
        let position, remoteError;
        try {
          position = await read(`/api/skychart/resolve?name=${encodeURIComponent(target)}`, signal);
        } catch (error) {
          if (signal.aborted || version !== searchVersion) return;
          remoteError = error;
          const catalogue = await getCatalogue();
          if (signal.aborted || version !== searchVersion) return;
          position = cataloguePosition(target, catalogue);
          if (!position) {
            const missing = new Error(`${error.message}; no matching name in the bundled catalogue`);
            missing.attempts = error.attempts;
            throw missing;
          }
        }
        if (signal.aborted || version !== searchVersion) return;
        searchController = undefined;
        aladin.gotoRaDec(position.ra, position.dec);
        onSearch({ state: 'ready', source: position.source, attempts: remoteError?.attempts || position.attempts || [], local: !!remoteError });
        options.success?.(aladin.getRaDec());
      })().catch(error => {
        if (signal.aborted || version !== searchVersion) return;
        searchController = undefined;
        onSearch({ state: 'error', error: error.message, attempts: error.attempts || [] });
        options.error?.(error);
      });
    };

    return {
      selectSurvey, cancelSearch,
      retry: () => selectSurvey(currentId),
      dispose() { stopSurvey(); cancelSearch(); aladin.gotoObject = originalGotoObject; },
    };
  }

  root.APDSkyServices = { create, cataloguePosition };
})(globalThis);
