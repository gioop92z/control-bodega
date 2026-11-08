type PickerDocument = { id: string; mimeType: string; name: string };
type PickerResponse = { action: string; docs?: PickerDocument[] };
type PickerBuilder = {
  setAppId: (value: string) => PickerBuilder;
  setDeveloperKey: (value: string) => PickerBuilder;
  setOAuthToken: (value: string) => PickerBuilder;
  setOrigin: (value: string) => PickerBuilder;
  addView: (view: unknown) => PickerBuilder;
  setCallback: (callback: (result: PickerResponse) => void) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};
type GooglePicker = {
  Action: { PICKED: string; CANCEL: string };
  ViewId: { DOCS: string };
  DocsView: new (id: string) => { setMimeTypes: (types: string) => unknown };
  PickerBuilder: new () => PickerBuilder;
};
type OAuthClient = { requestAccessToken: (options: { prompt: string }) => void };
type GoogleOAuth = {
  initTokenClient: (options: {
    client_id: string; scope: string; callback: (result: { access_token?: string }) => void; error_callback: () => void;
  }) => OAuthClient;
};
type GoogleWindow = Window & {
  google?: { picker?: GooglePicker; accounts?: { oauth2: GoogleOAuth } };
  gapi?: { load: (component: string, options: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }) => void };
};

declare const __VANIFS_DRIVE_CONFIG__: { clientId: string; apiKey: string; appId: string };
const config = __VANIFS_DRIVE_CONFIG__;
export const driveEnabled = Boolean(config.clientId && config.apiKey && config.appId);
const sheetsMime = "application/vnd.google-apps.spreadsheet";
const excelMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const fileTypes = [sheetsMime, excelMime, "text/csv", "text/tab-separated-values", "text/plain"];
const maxFileBytes = 10 * 1024 * 1024;
let ready: Promise<void> | undefined;

function script(src: string) {
  return new Promise<void>((resolve, reject) => {
    const element = document.createElement("script");
    const fail = () => { element.remove(); reject(new Error("No se pudo abrir Google Drive.")); };
    const timeout = window.setTimeout(fail, 15000);
    element.src = src;
    element.async = true;
    element.onload = () => { clearTimeout(timeout); resolve(); };
    element.onerror = () => { clearTimeout(timeout); fail(); };
    document.head.append(element);
  });
}

export function prepareDrivePicker() {
  const site = window as GoogleWindow;
  ready ??= Promise.all([
    site.google?.accounts ? Promise.resolve() : script("https://accounts.google.com/gsi/client"),
    site.gapi ? Promise.resolve() : script("https://apis.google.com/js/api.js"),
  ]).then(() => new Promise<void>((resolve, reject) => {
    const fail = () => reject(new Error("No se pudo preparar el selector de Drive."));
    if (!site.gapi || !site.google?.accounts) return fail();
    if (site.google.picker) return resolve();
    site.gapi.load("picker", { callback: resolve, onerror: fail, ontimeout: fail, timeout: 10000 });
  })).catch(error => { ready = undefined; throw error; });
  return ready;
}

async function download(item: PickerDocument, token: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(item.id) || !fileTypes.includes(item.mimeType)) {
    throw new Error("Selecciona un Excel, CSV o Google Sheets autorizado.");
  }
  const base = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(item.id);
  const options = { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(20000) };
  const metadata = await fetch(base + "?fields=capabilities(canDownload),size&supportsAllDrives=true", options);
  if (!metadata.ok) throw new Error("No se pudo verificar el permiso de descarga.");
  const { capabilities, size } = await metadata.json();
  if (!capabilities?.canDownload || Number(size ?? 0) > maxFileBytes) {
    throw new Error("Se requiere permiso de descarga y un archivo de hasta 10 MB.");
  }
  const spreadsheet = item.mimeType === sheetsMime;
  const response = await fetch(base + (spreadsheet ? "/export?mimeType=" + encodeURIComponent(excelMime) : "?alt=media&supportsAllDrives=true"), options);
  if (!response.ok) throw new Error("No se pudo descargar el manifiesto autorizado.");
  const blob = await response.blob();
  if (blob.size > maxFileBytes) throw new Error("El manifiesto supera los 10 MB.");
  return new File([blob], spreadsheet ? item.name + ".xlsx" : item.name, { type: spreadsheet ? excelMime : item.mimeType });
}

export function chooseDriveFile() {
  const site = window as GoogleWindow;
  return new Promise<File | null>((resolve, reject) => {
    const picker = site.google?.picker;
    const auth = site.google?.accounts?.oauth2;
    if (!driveEnabled || !picker || !auth) return reject(new Error("Prepara primero el selector de Drive."));
    const oauth = auth.initTokenClient({
      client_id: config.clientId, scope: "https://www.googleapis.com/auth/drive.file",
      error_callback: () => reject(new Error("Google Drive no pudo verificar tu autorización.")),
      callback: ({ access_token }) => {
        if (!access_token) return reject(new Error("Se requiere autorización para el archivo elegido."));
        try {
          const view = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes(fileTypes.join(","));
          new picker.PickerBuilder().setAppId(config.appId).setDeveloperKey(config.apiKey)
            .setOAuthToken(access_token).setOrigin(location.origin).addView(view)
            .setCallback(result => {
              if (result.action === picker.Action.CANCEL) resolve(null);
              if (result.action === picker.Action.PICKED && result.docs?.[0]) {
                void download(result.docs[0], access_token).then(resolve, reject);
              }
            }).build().setVisible(true);
        } catch (error) { reject(error); }
      },
    });
    oauth.requestAccessToken({ prompt: "" });
  });
}
