import { Pagination } from '../components/Pagination';
import { PostCard } from '../components/PostCard';
import { StateNotice } from '../components/StateNotice';
import { paginate, publishedPosts } from '../lib/archive.js';
import { cmsConfig } from '../config/cmsConfig';
import type { CmsContentItem, CmsDataset } from '../types';

export function PostsPage(props: { dataset: CmsDataset; page: number }) {
  const page = paginate(publishedPosts(props.dataset.posts), props.page, cmsConfig.content.pageSize);
  return (
    <div className="page">
      <h1>Posts</h1>
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Posts are unavailable" message="The posts index could not be read from QDN. This is not an empty site." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No published posts yet" message="The catalog is readable and contains no published posts." />
      ) : (
        <>
          <div className="card-grid">
            {page.items.map((item: CmsContentItem) => <PostCard key={item.id} item={item} dataset={props.dataset} />)}
          </div>
          <Pagination
            page={page.page}
            totalPages={page.totalPages}
            totalItems={page.totalItems}
            label="Post pages"
            hrefForPage={(value) => (value > 1 ? '#/posts?page=' + value : '#/posts')}
          />
        </>
      )}
    </div>
  );
}
