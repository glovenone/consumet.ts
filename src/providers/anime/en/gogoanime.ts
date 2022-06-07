import axios from 'axios';
import { load } from 'cheerio';

import {
  AnimeParser,
  IAnimeSearch,
  IAnimeInfo,
  IEpisodeServer,
  IVideo,
  StreamingServers,
} from '../../../models';
import { GogoCDN, StreamSB, USER_AGENT } from '../../../utils';

class Gogoanime extends AnimeParser {
  override readonly name = 'gogoanime';
  protected override baseUrl = 'https://gogoanime.gg';

  override search = async (query: string, page: number = 1): Promise<IAnimeSearch> => {
    const searchResult: IAnimeSearch = { hasNextPage: false, results: [] };
    try {
      const res = await axios.get(
        `${this.baseUrl}/search.html?keyword=${encodeURIComponent(query)}&page=${page}`
      );

      const $ = load(res.data);

      searchResult.currentPage = page;
      searchResult.hasNextPage =
        $('div.anime_name.new_series > div > div > ul > li.selected').next().length > 0;

      $('div.last_episodes > ul > li').each((i, el) => {
        searchResult.results.push({
          id: $(el).find('p.name > a').attr('href')?.split('/')[2]!,
          title: $(el).find('p.name > a').attr('title')!,
          url: `${this.baseUrl}/${$(el).find('p.name > a').attr('href')}`,
          image: $(el).find('div > a > img').attr('src'),
          releaseDate: $(el).find('p.released').text().trim(),
        });
      });

      return searchResult;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  override fetchAnimeInfo = async (animeUrl: string): Promise<IAnimeInfo> => {
    if (!animeUrl.startsWith(this.baseUrl)) animeUrl = `${this.baseUrl}/category/${animeUrl}`;

    const animeInfo: IAnimeInfo = {
      id: '',
      title: '',
      url: animeUrl,
      genres: [],
      episodes: [],
    };
    try {
      const res = await axios.get(animeUrl);

      const $ = load(res.data);

      animeInfo.id = new URL(animeUrl).pathname.split('/')[2];
      animeInfo.title = $(
        'section.content_left > div.main_body > div:nth-child(2) > div.anime_info_body_bg > h1'
      )
        .text()
        .trim();
      animeInfo.url = animeUrl;
      animeInfo.image = $('div.anime_info_body_bg > img').attr('src');
      animeInfo.releaseDate = $('div.anime_info_body_bg > p:nth-child(7)')
        .text()
        .trim()
        .split('Released: ')[1];
      animeInfo.description = $('div.anime_info_body_bg > p:nth-child(5)')
        .text()
        .trim()
        .replace('Plot Summary: ', '');
      animeInfo.type = $('div.anime_info_body_bg > p:nth-child(4) > a').text().trim();
      animeInfo.status = $('div.anime_info_body_bg > p:nth-child(8) > a').text().trim();
      animeInfo.otherName = $('div.anime_info_body_bg > p:nth-child(9)')
        .text()
        .replace('Other name: ', '')
        .replace(/;/g, ',');

      $('div.anime_info_body_bg > p:nth-child(6) > a').each((i, el) => {
        animeInfo.genres?.push($(el).attr('title')!.toString());
      });

      const ep_start = $('#episode_page > li').first().find('a').attr('ep_start');
      const ep_end = $('#episode_page > li').last().find('a').attr('ep_end');
      const movie_id = $('#movie_id').attr('value');
      const alias = $('#alias_anime').attr('value');

      const html = await axios.get(
        `https://ajax.gogo-load.com/ajax/load-list-episode?ep_start=${ep_start}&ep_end=${ep_end}&id=${movie_id}&default_ep=${0}&alias=${alias}`
      );
      const $$ = load(html.data);

      $$('#episode_related > li').each((i, el) => {
        animeInfo.episodes?.push({
          id: $(el).find('a').attr('href')?.split('/')[1]!,
          number: parseInt($(el).find(`div.name`).text().replace('EP ', '')),
          url: `${this.baseUrl}/${$(el).find(`a`).attr('href')?.trim()}`,
        });
      });

      animeInfo.totalEpisodes = parseInt(ep_end ?? '0');

      return animeInfo;
    } catch (err) {
      throw new Error("Anime doesn't exist.");
    }
  };

  override fetchEpisodeSources = async (
    episodeId: string,
    server: StreamingServers = StreamingServers.GogoCDN
  ): Promise<{ headers: { [k: string]: string }; sources: IVideo[] }> => {
    if (episodeId.startsWith('http')) {
      const serverUrl = new URL(episodeId);
      switch (server) {
        case StreamingServers.GogoCDN:
          return {
            headers: { Referer: serverUrl.href },
            sources: await new GogoCDN().extract(serverUrl),
          };
        case StreamingServers.StreamSB:
          return {
            headers: { Referer: serverUrl.href, watchsb: 'streamsb', 'User-Agent': USER_AGENT },
            sources: await new StreamSB().extract(serverUrl),
          };
        default:
          return {
            headers: { Referer: serverUrl.href },
            sources: await new GogoCDN().extract(serverUrl),
          };
      }
    }

    try {
      const res = await axios.get(`${this.baseUrl}/${episodeId}`);

      const $ = load(res.data);

      let serverUrl: URL;

      switch (server) {
        case StreamingServers.GogoCDN:
          serverUrl = new URL(`https:${$('#load_anime > div > div > iframe').attr('src')}`);
          break;
        case StreamingServers.StreamSB:
          serverUrl = new URL(
            $('div.anime_video_body > div.anime_muti_link > ul > li.streamsb > a').attr(
              'data-video'
            )!
          );
          break;
        default:
          serverUrl = new URL(`https:${$('#load_anime > div > div > iframe').attr('src')}`);
          break;
      }

      return await this.fetchEpisodeSources(serverUrl.href, server);
    } catch (err) {
      console.error(err);
      throw new Error('Episode not found.');
    }
  };

  override fetchEpisodeServers = async (episodeLink: string): Promise<IEpisodeServer[]> => {
    try {
      if (!episodeLink.startsWith(this.baseUrl)) episodeLink = `${this.baseUrl}/${episodeLink}`;

      const res = await axios.get(episodeLink);

      const $ = load(res.data);

      const servers: IEpisodeServer[] = [];

      $('div.anime_video_body > div.anime_muti_link > ul > li').each((i, el) => {
        let url = $(el).find('a').attr('data-video');
        if (!url?.startsWith('http')) url = `https:${url}`;

        servers.push({
          name: $(el).find('a').text().replace('Choose this server', '').trim(),
          url: url,
        });
      });

      return servers;
    } catch (err) {
      throw new Error('Episode not found.');
    }
  };
}

export default Gogoanime;
