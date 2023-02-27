const base_url = `https://yt.lemnoslife.com/playlistItems`;
const key_input = document.getElementById('key');
const base_params = {
    key: localStorage.getItem("api_key") || "",
    part: 'snippet',
    maxResults: 50,
    order: 'date'
};
let playlist_id;
let player;

window.onYouTubeIframeAPIReady = () => {
    if (base_params.key) key_input.value = base_params.key;
    player = new YT.Player('player', {
        height: '360',
        width: '100%',
        events: {
            onReady: e => e.target.playVideo(),
            onStateChange: (e) => {
                if (e.data === 0) open_random_video();
            }
        },
    });
    display_cached_channels();
};


const rec_load = async () => {
    return new Promise((resolve) => {
        let videos = [];
        let load = next_page => {
            let params = {playlistId: playlist_id};
            if (next_page) params['pageToken'] = next_page;
            request(params).then(data => {
                videos = Array.from(new Set(videos.concat(data.items)));
                if (data.items.length === 100) load(data.nextPageToken);
                else resolve(videos);
            }, data => {
                console.warn(data);
                resolve(videos);
            })
        };
        load();
    })
};

const get_channel_videos = async channel => {
    let channel_videos = [];
    await getPlaylistId(channel.id);
    return new Promise((resolve) => {
        if (localStorage.getItem(`cc_id:${channel.id}`)) channel_videos = JSON.parse(localStorage.getItem(`cc_id:${channel.id}`));
        if (!channel_videos.length) {
            switch_loader(true);
            rec_load(channel.id).then(data => {
                localStorage.setItem(`cc_id:${channel.id}`, JSON.stringify(data));
                localStorage.setItem(`cc_up:${channel.id}`, new Date().toDateString());
                localStorage.setItem(`cc_name:${channel.id}`, channel.username);
                display_cached_channels();
                resolve(data);
                switch_loader(false);
            });
        } else {
            if (localStorage.getItem(`cc_up:${channel.id}`) === new Date().toDateString())
                resolve(channel_videos);
            else request({playlistId: playlist_id}).then(data => {
                console.log('load new videos');
                channel_videos = Array.from(new Set(channel_videos.concat(data.items)));
                localStorage.setItem(`cc_id:${channel.id}`, JSON.stringify(channel_videos));
                localStorage.setItem(`cc_up:${channel.id}`, new Date().toDateString());
                localStorage.setItem(`cc_name:${channel.username}`, channel.username);
                resolve(channel_videos);
            }, r => {
                console.error('error', r);
                resolve(channel_videos);
            });
        }
    });
};

const random_video = (arr) => {
    const max = arr.length;
    const random = ~~(Math.random() * (max - 1));
    if (arr[random]) return arr[random]['snippet']['resourceId']['videoId'];
    else return '';
};

const open_random_video = async (event) => {
    if (event) event.preventDefault();
    if (loading) return false;
    let channel_id = document.getElementById('channel_id').value;
    if (channel_id) {
        channel_id = validYT(channel_id) ? await getYoutubeChannelIdNew(channel_id) : {id: channel_id};
        player.loadVideoById(random_video(await get_channel_videos(channel_id)));
        make_visible_skip_button(10000)
    }
    return false;
};

async function getYoutubeChannelIdNew(url) {
    // "channelId\":\s\"(\w+)"
    let username = url.match(/(@\w+)/)
    if (username && username[1]) {
        username = username[1]
        let url = `https://yt.lemnoslife.com/channels?part=community&handle=${username}`;
        let body = await http({url: url});
        if (body && body.items && body.items.length) id = body.items[0].id;
        return {id, username};
    } else {
        throw new Error('cannot recognize youtube link')
    }

}

async function getPlaylistId(channel_id) {
    if (localStorage.getItem(`ccplid:${channel_id}`))
        playlist_id = localStorage.getItem(`ccplid:${channel_id}`);
    else {
        let playlistID = await http({
            url: `https://yt.lemnoslife.com/noKey/channels?part=contentDetails&id=${channel_id}`
        });
        playlist_id = playlistID['items'][0]['contentDetails']['relatedPlaylists']['uploads']
    }
    localStorage.setItem(`ccplid:${channel_id}`, playlist_id);
    return playlist_id;
}

const http = obj => {
    return new Promise((resolve, reject) => {
        let xhr = new XMLHttpRequest();
        xhr.open(obj.method || "GET", obj.url, true);
        if (obj.headers) {
            Object.keys(obj.headers).forEach(key => {
                xhr.setRequestHeader(key, obj.headers[key]);
            });
        }
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(JSON.parse(xhr.response));
            } else {
                reject(xhr.statusText);
            }
        };
        xhr.onerror = () => reject(xhr.statusText);
        xhr.send();
    });
};

const request = params => {
    params = params || {};
    const url_params = Object.entries({...base_params, ...params}).map(([key, val]) => `${key}=${val}`).join('&');
    const url_with_params = `${base_url}?${url_params}`;
    return http({url: url_with_params})
};

const validYT = url => {
    return (url.match(/^(?:https?:\/\/)?(?:www\.)?youtube\.com/)) ? url : false
};

const update_key = () => {
    base_params.key = key_input.value;
    localStorage.setItem('api_key', base_params.key);
    addKey(base_params.key)
};

let channels_in_storage;

const get_cached_channels = () => {
    let cached_channels = Object.keys(localStorage).filter(x => x.indexOf('cc_id:') > -1);
    channels_in_storage = [];
    cached_channels.forEach(x => {
        let lc_item = JSON.parse(localStorage[x]);
        channels_in_storage.push({
            id: x.replace("cc_id:", ""),
            title: localStorage[x.replace("cc_id:", "cc_name:")]
        })
    });
    return channels_in_storage;
};

const display_cached_channels = () => {
    const destination = document.getElementById('channels');
    const channel_id_el = document.getElementById('channel_id');
    destination.innerHTML = "";
    get_cached_channels().forEach(channel => {
        const button = document.createElement('button');
        button.className = 'btn btn-outline-primary';
        button.innerText = channel.title;
        button.onclick = () => (channel_id_el.value = channel.id) && open_random_video();
        destination.append(button);
    });
};

let loading = false;

const switch_loader = (state) => {
    const button = document.getElementById('random-video');
    loading = state;
    button.innerText = loading ? "loading..." : "RANDOM VIDEO";
};

async function addKey(key) {
    return await http({url: "https://yt.lemnoslife.com/addKey.php?key=" + key})
}

const show_key_input = () => {
    document.getElementById("ApiKeyForm").style.display = 'block';
}

let prev_timeout;
const make_visible_skip_button = (timeout = 5000) => {
    const button = document.getElementById('skip-video');
    button.style.display = 'block';
    if (prev_timeout) clearTimeout(prev_timeout)
    prev_timeout = setTimeout(() => {
        button.style.display = 'none';
    }, timeout)
}

