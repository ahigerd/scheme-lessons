(define-syntax -concat-name
  [(-concat-name ?a ?b) (string->symbol (string-append (symbol->string '?a) (symbol->string '?b)))]
)

(define-syntax -symbol-alist
  [(-symbol-alist ?n ?a . ?b) (cons (list '?a ?n) (-symbol-alist (+ ?n 1) . ?b))]
  [(-symbol-alist ?n) '()])

(define (-define-propgetx struct prop index)
  (let* [
    (symbol-append (lambda (parts) (string->symbol (apply string-append parts))))
    (structname (symbol->string struct))
    (propname (symbol->string prop))
    (struct? (symbol-append (list structname "?")))
    (struct-prop (symbol-append (list structname "-" propname)))
  ]
  (list 'define (list struct-prop 'x)
    (list 'if (list struct? 'x)
      (list 'list-ref 'x index)
      (list 'error (symbol->string struct-prop) "expects ~a, given ~a" structname 'x)
    )
  )
)

(define-syntax define-struct
  [(define-struct ?name ?props) (begin
     (eval (list 'define (-concat-name make- ?name) '(lambda ?props (list '?name . ?props))))
     (eval (list 'define (-concat-name ?name ?) '(lambda (x) (and (pair? x) (eq? (car x) '?name) (= (length '?props) (length (cdr x)))))))
     (for-each (lambda (p)
       (eval (apply (lambda (prop x) (-define-propgetx '?name prop x)) p))
     ) (-symbol-alist 1 . ?props))
  )]
)

(define-struct posn [x y])
