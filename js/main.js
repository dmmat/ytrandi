const base_url = `https://www.googleapis.com/youtube/v3/playlistItems`;
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
    console.log('ready to use');
    if (base_params.key) key_input.value = base_params.key;
    player = new YT.Player('player', {
        height: '600',
        width: '1200',
        events: {
            onReady: e => e.target.playVideo(),
            onStateChange: (e) => {
                if (e.data === 0) open_random_video();
            }
        },

    });
};


const rec_load = async () => {
    return new Promise((resolve) => {
        let videos = [];
        let load = next_page => {
            let params = {playlistId: playlist_id};
            if (next_page) params['pageToken'] = next_page;
            request(params).then(data => {
                videos = Array.from(new Set(videos.concat(data.items)));
                if (videos.length < data.pageInfo.totalResults) load(data.nextPageToken);
                else resolve(videos);
            }, data => {
                console.warn(data);
                resolve(videos);
            })
        };
        load();
    })
};

const get_chanel_videos = async channel_id => {
    let channel_videos = [];
    await getPlaylistId(channel_id);
    return new Promise((resolve) => {
        if (localStorage.getItem(`c_id:${channel_id}`)) channel_videos = JSON.parse(localStorage.getItem(`c_id:${channel_id}`));
        if (!channel_videos.length) {
            rec_load(channel_id).then(data => {
                localStorage.setItem(`c_id:${channel_id}`, JSON.stringify(data));
                localStorage.setItem(`c_up:${channel_id}`, new Date().toDateString());
                resolve(data);
            });
        } else {
            if (localStorage.getItem(`c_up:${channel_id}`) === new Date().toDateString())
                resolve(channel_videos);
            else request({playlistId: playlist_id}).then(data => {
                console.log('load new videos');
                channel_videos = Array.from(new Set(channel_videos.concat(data.items)));
                localStorage.setItem(`c_id:${channel_id}`, JSON.stringify(channel_videos));
                localStorage.setItem(`c_up:${channel_id}`, new Date().toDateString());
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
    let channel_id = document.getElementById('channel_id').value;
    if (channel_id) {
        channel_id = validYT(channel_id) ? await getYoutubeChannelId(channel_id) : channel_id;
        player.loadVideoById(random_video(await get_chanel_videos(channel_id)));
    }
    return false;
};

async function getYoutubeChannelId(url) {
    let id = '';
    let username;
    url = url.replace(/([><])/gi, '').split(/(\/channel\/|\/user\/)/);

    if (url[2] !== undefined) {
        id = url[2].split(/[^0-9a-z_-]/i);
        id = id[0];
    }

    if (/\/user\//.test(url)) username = id;

    if (!id) return false;

    if (username) {
        let url = `https://www.googleapis.com/youtube/v3/channels?part=id&forUsername=${username}&key=${base_params.key}`;
        let body = await http({url: url});
        if (body && body.items && body.items.length) id = body.items[0].id;
    }

    return id;
}

async function getPlaylistId(channel_id) {
    playlist_id = localStorage.getItem(`cplid:${channel_id}`)
        || await http({
            url: ` https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channel_id}&key=${base_params.key}`
        })['items'][0]['contentDetails']['relatedPlaylists']['uploads'];
    localStorage.setItem(`cplid:${channel_id}`, playlist_id);
    return playlist_id;
}

const http = obj => {
    return new Promise((resolve, reject) => {
        let xhr = new XMLHttpRequest();
        xhr.open(obj.method || "GET", obj.url);
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
        xhr.send(obj.body);
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
};
