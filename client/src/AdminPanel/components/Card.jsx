const Card = ({ title, description, actions, children, className = "" }) => (
  <section className={`ap-card ${className}`}>
    {(title || actions) && (
      <header className="ap-card-head">
        <div>
          {title && <h3 className="ap-card-title">{title}</h3>}
          {description && <p className="ap-card-desc">{description}</p>}
        </div>
        {actions && <div className="ap-card-actions">{actions}</div>}
      </header>
    )}
    <div className="ap-card-body">{children}</div>
  </section>
);

export default Card;
