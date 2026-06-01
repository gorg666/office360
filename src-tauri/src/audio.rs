use rodio::{Decoder, OutputStreamBuilder, Sink};
use std::{
    fs::File,
    io::{BufReader, Cursor},
    thread,
};

const DEFAULT_NOTIFICATION_SOUND: &[u8] = include_bytes!("../../src/assets/vfyvfyfy44.mp3");

#[tauri::command]
pub fn play_notification_sound(path: Option<String>, volume: f32) -> Result<(), String> {
    let volume = volume.clamp(0.0, 1.0);
    let sound_path = path.and_then(|p| {
        let trimmed = p.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    thread::Builder::new()
        .name("notification-sound".to_string())
        .spawn(move || {
            if let Err(err) = play_sound_blocking(sound_path, volume) {
                log::warn!("Failed to play notification sound: {err}");
            }
        })
        .map_err(|err| err.to_string())?;

    Ok(())
}

fn play_sound_blocking(path: Option<String>, volume: f32) -> Result<(), String> {
    let stream_handle = OutputStreamBuilder::open_default_stream().map_err(|err| err.to_string())?;
    let sink = Sink::connect_new(stream_handle.mixer());

    if let Some(path) = path {
        let file = File::open(path).map_err(|err| err.to_string())?;
        let source = Decoder::new(BufReader::new(file)).map_err(|err| err.to_string())?;
        sink.append(source);
    } else {
        let source = Decoder::new(BufReader::new(Cursor::new(DEFAULT_NOTIFICATION_SOUND.to_vec())))
            .map_err(|err| err.to_string())?;
        sink.append(source);
    }

    sink.set_volume(volume);
    sink.sleep_until_end();
    Ok(())
}
