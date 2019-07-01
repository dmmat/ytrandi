const base_url = `https://www.googleapis.com/youtube/v3/search`;
const key_input = document.getElementById('key');
const base_params = {
    key: localStorage.getItem("api_key") || "",
    part: 'snippet',
    maxResults: 50
};
let player;

window.onYouTubeIframeAPIReady = () => {
    console.log('ready to use');
    if (base_params.key) key_input.value = base_params.key;
    player = new YT.Player('player', {
        height: '600',
        width: '1200',
        events: {onReady: e => e.target.playVideo()}
    });
};


let stop = false;

const rec_load = chanel_id => {
    return new Promise((resolve) => {
        let videos = [];
        let load = next_page => {
            let params = {chanelId: chanel_id};
            if (next_page) params['pageToken'] = next_page;
            request(params).then(data => {
                videos = Array.from(new Set(videos.concat(data)));
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

const get_chanel_videos = chanel_id => {
    let chanel_videos = [];
    return new Promise((resolve) => {
        if (localStorage.getItem(chanel_id)) chanel_videos = JSON.parse(localStorage.getItem(chanel_id));
        if (!chanel_videos.length) {
            rec_load(chanel_id).then(data => {
                localStorage.setItem(chanel_id, data);
                resolve(data);
            });
        } else request({chanelId: chanel_id}).then(data => {
            chanel_videos = Array.from(new Set(chanel_videos.concat(data)));
            localStorage.setItem(chanel_id, chanel_videos);
            resolve(chanel_videos);
        }, r => {
            console.error('error', r);
            resolve(chanel_videos);
        });
    });
};

const random_video = (arr) => {
    const max = arr.length;
    const random = ~~(Math.random() * (max - 1));
    return arr[random]['id']['videoId'];
};

const open_random_video = async (event) => {
    event.preventDefault();
    let chanel_id = document.getElementById('chanel_id').value;
    if (chanel_id) {
        chanel_id = validYT(chanel_id) ? await getYoutubeChannelId(chanel_id) : chanel_id;
        get_chanel_videos(chanel_id).then(videos => {
            player.loadVideoById(random_video(videos))
        })
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
        let url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&forUsername=${username}&key=${key}`;
        let body = await http({url: url});
        if (body && body.items && body.items.length) id = body.items[0].id;
    }

    return id;
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
