(() => {
  'use strict';

  const MAX_BROWSER_PACK_BYTES = 256 * 1024 * 1024;
  const MAX_BROWSER_PACK_FILES = 5000;
  const textEncoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    crcTable[index] = value >>> 0;
  }

  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
    return (value ^ 0xffffffff) >>> 0;
  }

  function sha256(bytes) {
    return crypto.subtle.digest('SHA-256', bytes).then((digest) =>
      `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
    );
  }

  function safePath(file) {
    const value = String(file.webkitRelativePath || file.name || '').replace(/^\/+/, '');
    const parts = value.split('/');
    const forbidden = /[<>:"|?*\u0000-\u001f]/;
    const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
    if (!value || value.includes('\\') || new TextEncoder().encode(value).byteLength > 1024
      || parts.some((part) => !part || part === '.' || part === '..' || part.endsWith('.')
        || part.endsWith(' ') || forbidden.test(part) || reserved.test(part)
        || new TextEncoder().encode(part).byteLength > 255)) {
      throw new Error(`Unsafe file path: ${value || 'unnamed file'}`);
    }
    return value;
  }

  function dosDateTime(dateValue) {
    const candidate = new Date(Number.isFinite(Number(dateValue)) ? Number(dateValue) : 0);
    const date = Number.isNaN(candidate.getTime()) ? new Date(Date.UTC(1980, 0, 1)) : candidate;
    const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
    return {
      time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
    };
  }

  function zipHeader(length) {
    const buffer = new ArrayBuffer(length);
    return { bytes: new Uint8Array(buffer), view: new DataView(buffer) };
  }

  async function buildStoredZip(files, onProgress) {
    const ordered = Array.from(files).map((file) => ({ file, path: safePath(file) }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    if (!ordered.length) throw new Error('Choose a folder with at least one file.');
    if (ordered.length > MAX_BROWSER_PACK_FILES) throw new Error('This browser upload is limited to 5,000 files.');
    const sourceBytes = ordered.reduce((total, item) => total + item.file.size, 0);
    if (sourceBytes > MAX_BROWSER_PACK_BYTES) throw new Error('This browser upload is limited to 256 MiB.');
    const foldedPaths = new Set();
    ordered.forEach(({ path }) => {
      const folded = path.toLocaleLowerCase('en-US');
      if (foldedPaths.has(folded)) throw new Error(`Two files collide on a USB filesystem: ${path}`);
      foldedPaths.add(folded);
    });

    const localParts = [];
    const centralParts = [];
    const manifestFiles = [];
    let offset = 0;
    for (let index = 0; index < ordered.length; index += 1) {
      const { file, path } = ordered[index];
      const data = new Uint8Array(await file.arrayBuffer());
      const name = textEncoder.encode(path);
      const checksum = crc32(data);
      const timestamp = dosDateTime(file.lastModified);
      const local = zipHeader(30);
      local.view.setUint32(0, 0x04034b50, true);
      local.view.setUint16(4, 20, true);
      local.view.setUint16(6, 0x0800, true);
      local.view.setUint16(8, 0, true);
      local.view.setUint16(10, timestamp.time, true);
      local.view.setUint16(12, timestamp.date, true);
      local.view.setUint32(14, checksum, true);
      local.view.setUint32(18, data.byteLength, true);
      local.view.setUint32(22, data.byteLength, true);
      local.view.setUint16(26, name.byteLength, true);
      localParts.push(local.bytes, name, data);

      const central = zipHeader(46);
      central.view.setUint32(0, 0x02014b50, true);
      central.view.setUint16(4, 20, true);
      central.view.setUint16(6, 20, true);
      central.view.setUint16(8, 0x0800, true);
      central.view.setUint16(10, 0, true);
      central.view.setUint16(12, timestamp.time, true);
      central.view.setUint16(14, timestamp.date, true);
      central.view.setUint32(16, checksum, true);
      central.view.setUint32(20, data.byteLength, true);
      central.view.setUint32(24, data.byteLength, true);
      central.view.setUint16(28, name.byteLength, true);
      central.view.setUint32(42, offset, true);
      centralParts.push(central.bytes, name);
      offset += local.bytes.byteLength + name.byteLength + data.byteLength;
      manifestFiles.push({ path, sizeBytes: data.byteLength, sha256: await sha256(data) });
      onProgress?.(`Preparing ${index + 1} of ${ordered.length} files…`);
    }

    const centralOffset = offset;
    const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0);
    const end = zipHeader(22);
    end.view.setUint32(0, 0x06054b50, true);
    end.view.setUint16(8, ordered.length, true);
    end.view.setUint16(10, ordered.length, true);
    end.view.setUint32(12, centralSize, true);
    end.view.setUint32(16, centralOffset, true);
    const archive = new Blob([...localParts, ...centralParts, end.bytes], { type: 'application/zip' });
    return {
      archive,
      manifest: { schemaVersion: 1, files: manifestFiles },
      contentHash: await sha256(await archive.arrayBuffer())
    };
  }

  function init({ withSession }) {
    const client = window.MXApplicationClient?.equipmentPacks;
    if (!client || typeof withSession !== 'function') return;
    const byId = (id) => document.getElementById(id);
    const packSelect = byId('settingsPackSelect');
    const versionSelect = byId('settingsPackVersion');
    const deviceSelect = byId('settingsPackDevice');
    const folderInput = byId('settingsPackFolder');
    const folderChoose = byId('settingsPackFolderChoose');
    const folderName = byId('settingsPackFolderName');
    const publishButton = byId('settingsPackPublish');
    const publishManualsButton = byId('settingsPackPublishManuals');
    const assignButton = byId('settingsPackAssign');
    const archiveButton = byId('settingsPackArchive');
    const status = byId('settingsPackStatus');
    const history = byId('settingsPackHistory');
    let packs = [];
    let versions = [];
    let uploadingVersions = [];
    let devices = [];

    const updateActions = () => {
      publishButton.disabled = !packSelect.value || !(folderInput.files || []).length;
      publishManualsButton.disabled = !packSelect.value;
      assignButton.disabled = !deviceSelect.value || !versionSelect.value;
      archiveButton.disabled = !packSelect.value;
    };

    const setStatus = (message, state = '') => {
      status.textContent = message;
      status.dataset.state = state;
    };
    const run = (operation) => withSession((session) => operation(session));
    const uploadWithRetry = async (versionId, blockIndex, block) => {
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          return await run((session) => client.uploadBlock(versionId, blockIndex, block, session));
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 400 * (2 ** (attempt - 1))));
        }
      }
      throw lastError;
    };
    const fill = (select, items, placeholder, label) => {
      select.replaceChildren(new Option(placeholder, ''));
      items.forEach((item) => select.appendChild(new Option(label(item), item.id)));
    };

    async function loadVersions() {
      const packId = packSelect.value;
      versions = [];
      uploadingVersions = [];
      fill(versionSelect, [], 'Select a published version', () => '');
      if (!packId) return updateActions();
      const payload = await run((session) => client.versions(packId, session));
      versions = (payload.versions || []).filter((version) => version.status === 'published');
      uploadingVersions = (payload.versions || []).filter((version) => version.status === 'uploading');
      fill(versionSelect, versions, versions.length ? 'Select a published version' : 'No published versions',
        (version) => `Version ${version.versionNumber} · ${Math.ceil(version.byteSize / 1024)} KiB`);
      updateActions();
    }

    async function loadHistory() {
      history.replaceChildren();
      if (!deviceSelect.value) return;
      const payload = await run((session) => window.MXApplicationClient.edgeDevices.deployments(deviceSelect.value, session));
      const entries = (payload.deployments || []).slice(0, 6);
      if (!entries.length) {
        history.textContent = 'No deployment activity yet.';
        return;
      }
      entries.forEach((entry) => {
        const row = document.createElement('span');
        row.textContent = `Generation ${entry.generation} · ${entry.state}${entry.activeSlot ? ` · slot ${entry.activeSlot}` : ''}`;
        history.appendChild(row);
      });
    }

    async function refresh() {
      setStatus('Loading Equipment Drives…');
      try {
        const [packPayload, devicePayload] = await Promise.all([
          run((session) => client.list(session)),
          run((session) => window.MXApplicationClient.edgeDevices.list(session))
        ]);
        packs = packPayload.packs || [];
        devices = (devicePayload.devices || []).filter((device) => device.status !== 'revoked');
        fill(packSelect, packs, packs.length ? 'Select a drive' : 'Create the first drive',
          (pack) => `${pack.name} · ${pack.equipmentFamily}`);
        fill(deviceSelect, devices, devices.length ? 'Select a device' : 'Register a device first',
          (device) => `${device.displayName} · ${device.status}`);
        await loadVersions();
        updateActions();
        setStatus(`${packs.length} drive${packs.length === 1 ? '' : 's'} · ${devices.length} available device${devices.length === 1 ? '' : 's'}`, 'success');
      } catch (error) {
        setStatus(error.message || 'Unable to load Equipment Drives.', 'error');
      }
    }

    byId('settingsPackCreate')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      setStatus('Creating Equipment Drive…');
      try {
        const payload = await run((session) => client.create({
          name: byId('settingsPackName').value.trim(),
          equipmentFamily: byId('settingsPackFamily').value.trim(),
          description: byId('settingsPackDescription').value.trim() || null,
          session
        }));
        event.currentTarget.reset();
        await refresh();
        packSelect.value = payload.pack.id;
        await loadVersions();
        setStatus(`${payload.pack.name} is ready for a folder.`, 'success');
      } catch (error) {
        setStatus(error.message || 'Unable to create Equipment Drive.', 'error');
      }
    });

    archiveButton?.addEventListener('click', async () => {
      const pack = packs.find((candidate) => candidate.id === packSelect.value);
      if (!pack) return setStatus('Select an Equipment Drive to remove.', 'error');
      if (!window.confirm(`Remove "${pack.name}" from Equipment Drives? Published files stay archived in Azure and the drive cannot be removed while assigned to a Pi.`)) return;
      archiveButton.disabled = true;
      setStatus(`Removing ${pack.name}…`);
      try {
        await run((session) => client.archive(pack.id, session));
        await refresh();
        setStatus(`${pack.name} was removed. Its published files remain archived in Azure.`, 'success');
      } catch (error) {
        setStatus(error.message || 'Unable to remove this Equipment Drive.', 'error');
      } finally {
        updateActions();
      }
    });

    folderChoose?.addEventListener('click', () => folderInput?.click());

    folderInput?.addEventListener('change', () => {
      const selected = Array.from(folderInput.files || []);
      const bytes = selected.reduce((total, file) => total + file.size, 0);
      const relativePath = selected[0]?.webkitRelativePath || '';
      const selectedFolder = relativePath.split('/')[0];
      if (folderName) {
        folderName.textContent = selected.length
          ? `${selectedFolder || 'Selected folder'} · ${selected.length} file${selected.length === 1 ? '' : 's'}`
          : 'No folder selected';
        folderName.title = selectedFolder || '';
      }
      setStatus(selected.length ? `${selected.length} files selected · ${(bytes / 1048576).toFixed(1)} MiB` : 'Choose a folder to publish.');
      updateActions();
    });

    byId('settingsPackPublish')?.addEventListener('click', async () => {
      if (!packSelect.value) return setStatus('Select or create an Equipment Drive first.', 'error');
      const files = Array.from(folderInput.files || []);
      if (!files.length) return setStatus('Choose a folder first.', 'error');
      const button = publishButton;
      button.disabled = true;
      try {
        const prepared = await buildStoredZip(files, setStatus);
        const resumable = uploadingVersions.find((version) => version.contentHash === prepared.contentHash
          && version.byteSize === prepared.archive.size
          && version.fileCount === prepared.manifest.files.length);
        setStatus(resumable ? `Resuming version ${resumable.versionNumber}…` : 'Creating the cloud version…');
        const created = resumable
          ? await run((session) => client.uploadStatus(resumable.id, session))
          : await run((session) => client.createVersion(packSelect.value, {
            manifest: prepared.manifest,
            contentHash: prepared.contentHash,
            byteSize: prepared.archive.size,
            fileCount: prepared.manifest.files.length,
            session
          }));
        const { version, upload } = created;
        const storedBlocks = new Map((upload.blocks || []).map((block) => [block.blockIndex, block]));
        for (let index = 0; index < upload.blockCount; index += 1) {
          const start = index * upload.blockSize;
          const block = prepared.archive.slice(start, Math.min(start + upload.blockSize, prepared.archive.size));
          const stored = storedBlocks.get(index);
          if (stored?.byteSize === block.size && stored.contentHash === await sha256(await block.arrayBuffer())) {
            setStatus(`Verified stored block ${index + 1} of ${upload.blockCount}…`);
            continue;
          }
          setStatus(`Uploading block ${index + 1} of ${upload.blockCount}…`);
          await uploadWithRetry(version.id, index, block);
        }
        setStatus('Verifying and publishing in Azure…');
        await run((session) => client.publishVersion(version.id, session));
        folderInput.value = '';
        if (folderName) {
          folderName.textContent = 'No folder selected';
          folderName.title = '';
        }
        await loadVersions();
        versionSelect.value = version.id;
        setStatus(`Version ${version.versionNumber} published and ready to assign.`, 'success');
      } catch (error) {
        setStatus(error.message || 'Equipment Drive publication failed.', 'error');
      } finally {
        updateActions();
      }
    });

    publishManualsButton?.addEventListener('click', async () => {
      if (!packSelect.value) return setStatus('Select or create an Equipment Drive first.', 'error');
      publishManualsButton.disabled = true;
      setStatus('Packaging the approved Azure manuals and linked diagrams…');
      try {
        const payload = await run((session) => client.publishManualLibrary(packSelect.value, session));
        await loadVersions();
        versionSelect.value = payload.version.id;
        const source = payload.source || {};
        const detail = `${source.manualCount || 0} manuals · ${source.chunkCount || 0} searchable sections · ${source.imageCount || 0} linked diagrams`;
        setStatus(payload.reused
          ? `The current Azure library is already published · ${detail}`
          : `Azure library published as version ${payload.version.versionNumber} · ${detail}`, 'success');
      } catch (error) {
        setStatus(error.message || 'Unable to publish the approved Azure library.', 'error');
      } finally {
        updateActions();
      }
    });

    byId('settingsPackAssign')?.addEventListener('click', async () => {
      if (!deviceSelect.value || !versionSelect.value) return setStatus('Select both a device and a published version.', 'error');
      const button = assignButton;
      button.disabled = true;
      setStatus('Sending the desired version to the device…');
      try {
        const result = await run((session) => client.assignVersion(deviceSelect.value, versionSelect.value, session));
        setStatus(`Generation ${result.generation} assigned. The node will reconcile automatically.`, 'success');
        await loadHistory();
      } catch (error) {
        setStatus(error.message || 'Unable to assign this version.', 'error');
      } finally {
        updateActions();
      }
    });

    packSelect?.addEventListener('change', () => loadVersions().catch((error) => setStatus(error.message, 'error')));
    versionSelect?.addEventListener('change', updateActions);
    deviceSelect?.addEventListener('change', () => {
      updateActions();
      loadHistory().catch((error) => setStatus(error.message, 'error'));
    });
    byId('settingsPackRefresh')?.addEventListener('click', () => refresh());
    window.addEventListener('mxg:edge-devices-changed', () => refresh());
    void refresh();
  }

  window.MXEquipmentPacks = Object.freeze({ init, buildStoredZip });
})();
